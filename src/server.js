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
  const { ruc, razonSocial, email, items, cuentas } = req.body;

  try {
    console.log(`\n--- EMISIÓN SOLICITADA POR ADMIN: CLIENTE ${ruc} ---`);

    const clienteData = {
      tipoDocumento: '6', // RUC
      numeroDocumento: ruc,
      razonSocial: razonSocial || 'CLIENTE DESCONOCIDO',
      direccion: 'Av. Cliente, Lima',
      correlativo: String(Date.now()).slice(-4), // Correlativo temporal basado en tiempo (Dina-mismo)
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

    const fileName = `20615357848-01-F001-${clienteData.correlativo}`;
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
        rucEmisor: '20615357848', 
        serie: 'F001', 
        correlativo: clienteData.correlativo, 
        hash: resultado.hashFirma 
      },
      pdfPath
    );

    // 3. Enviar por Mail
    if (email && email.trim() !== '') {
      await MailService.enviarFactura(email, { serie: 'F001', correlativo: clienteData.correlativo }, [pdfPath, xmlPath]);
    }

    res.json({ exito: true, cdr: resultado.cdr, pdf: `${fileName}.pdf` });

  } catch (error) {
    console.error('Error procesando emisión:', error);
    res.status(500).json({ exito: false, error: 'Ocurrió un error inesperado al procesar la factura.' });
  }
});

app.listen(PORT, () => {
    console.log(`\n🚀 PORTAL DE FACTURACIÓN RELIÉ LABS PROTEGIDO EN: http://localhost:${PORT}`);
});
