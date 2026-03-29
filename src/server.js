import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Importar servicios profesionales
import FacturacionController from './facturacion.controller.js';
import PdfGenerator from './pdf.generator.js';
import MailService from './mail.service.js';
import firebaseService from './firebase.service.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

// Configuración de Middleware
app.use(cors());
app.use(cookieParser());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- SISTEMA DE AUTENTICACIÓN (Rápido y Seguro) ---

const { ADMIN_USER = 'admin', ADMIN_PASS = 'relie2026' } = process.env;

/** Middleware para proteger rutas privadas */
const authMiddleware = (req, res, next) => {
    const sessionToken = req.cookies.session;
    if (sessionToken === 'authenticated-relie') {
        next();
    } else {
        res.status(401).redirect('/');
    }
};

/** Endpoint de Login */
app.post('/api/login', (req, res) => {
    const { user, pass } = req.body;
    if (user === ADMIN_USER && pass === ADMIN_PASS) {
        res.cookie('session', 'authenticated-relie', { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }); // 1 día
        res.status(200).json({ ok: true });
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
});

/** Ruta Protegida: Portal de Facturación */
app.get('/facturacion', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/facturacion.html'));
});

// --- API DE FACTURACIÓN (PROTEGIDA) ---

const facturador = new FacturacionController();

app.post('/api/emitir', authMiddleware, async (req, res) => {
  const { ruc, razonSocial, direccion, email, items, cuentas } = req.body;

  try {
    console.log(`\n--- EMISIÓN SOLICITADA POR ADMIN: CLIENTE ${ruc} ---`);

    // 0. Autonumeración: Consultar cuántas facturas hay para generar el correlativo
    const stats = await firebaseService.getEstadisticas();
    const nextCorrelativo = String(stats.numFacturas + 1).padStart(4, '0');

    const clienteData = {
      tipoDocumento: '6', // RUC
      numeroDocumento: ruc,
      razonSocial: razonSocial || 'CLIENTE DESCONOCIDO',
      direccion: direccion || 'Av. Cliente, Lima',
      correlativo: nextCorrelativo, 
      moneda: 'PEN'
    };

    // 1. Emitir a SUNAT
    const resultado = await facturador.emitirFactura(clienteData, items);

    if (!resultado.exito) {
      return res.status(400).json({ exito: false, error: resultado.error });
    }

    // 2. Generar el PDF
    const subTotal = items.reduce((acc, el) => acc + (el.precioUnitario * el.cantidad), 0);
    const igv = subTotal * 0.18;
    const total = subTotal + igv;

    const rucEmisor = process.env.EMPRESA_RUC || '20615357848';
    const fileName = `${rucEmisor}-01-F001-${clienteData.correlativo}`;
    const pdfPath = path.join(__dirname, '..', 'comprobantes', `${fileName}.pdf`);
    const xmlPath = path.join(__dirname, '..', 'comprobantes', `${fileName}.xml`);

    await PdfGenerator.build(
      { 
        cliente: clienteData, 
        items: items, 
        resumen: { subtotal: subTotal, igv: igv, total: total },
        cuentasBancarias: cuentas.map(c => ({ banco: c.banco, nro: c.nro, cci: c.cci }))
      },
      { 
        rucEmisor: rucEmisor, 
        serie: 'F001', 
        correlativo: clienteData.correlativo, 
        hash: resultado.hashFirma 
      },
      pdfPath
    );

    // 3. Persistir en Firebase (Nube de Archivos y Base de Datos - Fase 2)
    let firebaseResult = { error: 'No se intentó.' };
    try {
        firebaseResult = await firebaseService.registrarFactura(
          { 
            ruc: ruc, 
            razonSocial: razonSocial, 
            total: total, 
            igv: igv, 
            items: items, 
            createdBy: req.cookies.user || 'admin_oscar' // Usamos la cookie del usuario logueado
          },
          pdfPath,
          xmlPath
        );
    } catch (fbError) {
        console.warn('⚠️ Advertencia: Error en Firebase, pero la factura sigue siendo válida.', fbError.message);
        firebaseResult = { error: 'Falló conexión con Firebase Storage/Firestore.' };
    }

    // 4. Enviar por Mail (Usando la URL de Firebase para mayor seguridad)
    if (email && email.trim() !== '') {
      await MailService.enviarFactura(email, { serie: 'F001', correlativo: clienteData.correlativo }, [pdfPath, xmlPath]);
    }

    res.json({ 
      exito: true, 
      cdr: resultado.cdr, 
      pdf: `${fileName}.pdf`,
      firebase: firebaseResult 
    });

  } catch (error) {
    console.error('Error procesando emisión:', error);
    res.status(500).json({ exito: false, error: 'Ocurrió un error inesperado al procesar la factura.' });
  }
});

/** API: Obtener Historial de Facturas (Estadísticas del CEO) */
app.get('/api/historial', authMiddleware, async (req, res) => {
    try {
        const snapshot = await firebaseService.db.collection('facturas').orderBy('fecha', 'desc').get();
        const docs = [];
        snapshot.forEach(doc => docs.push(doc.data()));
        res.json(docs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/** API: Obtener Estadísticas Rápidas */
app.get('/api/stats', authMiddleware, async (req, res) => {
    try {
        const stats = await firebaseService.getEstadisticas();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/** API Proxy: Consultar RUC Protegido con Token (backend) */
app.get('/api/ruc/:ruc', authMiddleware, async (req, res) => {
    const { ruc } = req.params;
    const token = process.env.RUC_API_TOKEN;

    if (!token) return res.status(500).json({ error: 'Configuración de RUC API omitida en Render.' });

    try {
        const url = `https://api.rucdni.pe/api/v1/ruc/${ruc}?token=${token}`;
        console.log(`[RUC-API] Consultando: ${ruc}...`);
        
        const response = await fetch(url);
        const data = await response.json();
        
        console.log(`[RUC-API] Respuesta de RucDni.pe:`, JSON.stringify(data));

        if (data && data.success) {
            res.json({
                razon_social: data.data.nombre_o_razon_social,
                direccion: data.data.direccion_completa || data.data.direccion || 'Dirección no disponible'
            });
        } else {
            console.warn(`[RUC-API] ⚠️ RUC no encontrado o error de API:`, data.message || 'Sin mensaje');
            res.status(404).json({ error: data.message || 'RUC no encontrado.' });
        }
    } catch (err) {
        console.error(`[RUC-API] ❌ Error fatal en Proxy:`, err.message);
        res.status(500).json({ error: 'Error interno consultando RUC.' });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 PORTAL DE FACTURACIÓN RELIÉ LABS PROTEGIDO EN: http://localhost:${PORT}`);
});
