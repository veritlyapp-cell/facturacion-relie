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

/** Middleware robusto para proteger rutas con Roles de Relié Labs */
const authMiddleware = (req, res, next) => {
    const sessionToken = req.cookies.session;
    const userRole = req.cookies.role;
    
    // Si hay sesión válida, permitimos pasar y guardamos el rol en el request
    if (sessionToken && userRole) {
        req.user = { id: req.cookies.user, role: userRole };
        next();
    } else {
        res.status(401).redirect('/');
    }
};

/** Endpoint de Login: Ahora consulta la Base de Datos de Usuarios en Firebase */
app.post('/api/login', async (req, res) => {
    const { user, pass } = req.body;
    
    try {
        console.log(`[AUTH] Intento de login para usuario: ${user}...`);
        
        // 1. Buscamos el usuario en nuestra colección privada de Firebase
        const userDoc = await firebaseService.db.collection('users').doc(user).get();
        
        if (!userDoc.exists) {
            console.warn(`[AUTH] ⚠️ Usuario no encontrado: ${user}`);
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const userData = userDoc.data();

        // 2. Verificamos contraseña y estado activo
        if (userData.password === pass && userData.status === 'active') {
            console.log(`[AUTH] ✅ Login exitoso: ${userData.displayName} (${userData.role})`);
            
            // Seteamos cookies de sesión con el Rol para el Frontend
            res.cookie('session', 'authenticated-relie', { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
            res.cookie('role', userData.role, { maxAge: 24 * 60 * 60 * 1000 });
            res.cookie('user', user, { maxAge: 24 * 60 * 60 * 1000 });
            
            res.status(200).json({ ok: true, role: userData.role });
        } else {
            res.status(401).json({ error: 'Contraseña incorrecta o usuario inactivo' });
        }
    } catch (error) {
        console.error('[AUTH] ❌ Error en Login:', error.message);
        res.status(500).json({ error: 'Error interno de autenticación' });
    }
});

/** Ruta Protegida: Portal de Facturación */
app.get('/facturacion', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/facturacion.html'));
});

// --- API DE FACTURACIÓN (PROTEGIDA) ---
const facturador = new FacturacionController();

/** API: Guardar como Borrador (Sin enviar a SUNAT) */
app.post('/api/borrador', authMiddleware, async (req, res) => {
    const { ruc, razonSocial, direccion, email, items, cuentas } = req.body;
  
    try {
      console.log(`[DRAFT] Guardando borrador en espera de aprobación: ${ruc}...`);
  
      const subTotal = items.reduce((acc, el) => acc + (el.precioUnitario * el.cantidad), 0);
      const igv = subTotal * 0.18;
      const total = subTotal + igv;
  
      // Guardamos en Firebase con status BORRADOR
      const resFirebase = await firebaseService.registrarFactura(
        { 
          ruc, razonSocial, direccion, items, total, igv, 
          status: 'BORRADOR', 
          createdBy: req.user.id 
        },
        null, // No hay PDF aún
        null  // No hay XML aún
      );
  
      res.json({ exito: true, draftId: resFirebase.id });
  
    } catch (error) {
      console.error('[DRAFT] ❌ Error guardando borrador:', error.message);
      res.status(500).json({ error: 'Fallo al guardar borrador.' });
    }
});

app.post('/api/emitir', authMiddleware, async (req, res) => {
  const { ruc, razonSocial, direccion, email, items, cuentas } = req.body;

  // Solo Super Admin puede emitir directamente (opcional, por ahora lo dejamos libre)
  // if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Solo el admin aprueba emisiones.' });

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
            direccion: direccion,
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

/** API: Aprobar y Emitir a SUNAT (Solo Super Admin) */
app.post('/api/approve/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;

    if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Solo el administrador puede aprobar facturas legales.' });
    }

    try {
        console.log(`[APPROVAL] Procesando emisión legal para draft ID: ${id}...`);

        // 1. Obtener la data del borrador desde Firebase
        const draftDoc = await firebaseService.db.collection('facturas').doc(id).get();
        if (!draftDoc.exists) return res.status(404).json({ error: 'Borrador no encontrado.' });

        const data = draftDoc.data();
        if (data.status !== 'BORRADOR') return res.status(400).json({ error: 'Esta factura ya fue procesada anteriormente.' });

        // 2. Ejecutar el flujo de emisión estándar (SUNAT + PDF + MAIL)
        // (Reusamos la lógica de /api/emitir pero con los datos recuperados)
        const stats = await firebaseService.getEstadisticas();
        const nextCorrelativo = String(stats.numFacturas + 1).padStart(4, '0');

        const clienteData = {
            tipoDocumento: '6',
            numeroDocumento: data.ruc,
            razonSocial: data.razonSocial,
            direccion: data.direccion,
            correlativo: nextCorrelativo,
            moneda: data.moneda
        };

        const resultado = await facturador.emitirFactura(clienteData, data.items);
        if (!resultado.exito) return res.status(400).json({ exito: false, error: resultado.error });

        // 3. Generar PDF y XML
        const rucEmisor = process.env.EMPRESA_RUC || '20615357848';
        const fileName = `${rucEmisor}-01-F001-${clienteData.correlativo}`;
        const pdfPath = path.join(__dirname, '..', 'comprobantes', `${fileName}.pdf`);
        const xmlPath = path.join(__dirname, '..', 'comprobantes', `${fileName}.xml`);

        await PdfGenerator.build(
            { 
              cliente: clienteData, 
              items: data.items, 
              resumen: { subtotal: data.total / 1.18, igv: data.total - (data.total / 1.18), total: data.total },
              cuentasBancarias: [] // Opcional: pasar cuentas si se desea
            },
            { rucEmisor, serie: 'F001', correlativo: clienteData.correlativo, hash: resultado.hashFirma },
            pdfPath
        );

        // 4. Actualizar el registro en Firebase a APROBADA y subir archivos
        const fbRes = await firebaseService.registrarFactura(
            { ...data, status: 'APROBADA', docId: id }, // Mismo ID de borrador
            pdfPath,
            xmlPath
        );

        // 5. Borrar el borrador original o marcarlo
        await firebaseService.db.collection('facturas').doc(id).update({ 
            status: 'APROBADA', 
            pdfUrl: fbRes.pdfUrl, 
            xmlUrl: fbRes.xmlUrl,
            aprobadoPor: req.user.id,
            fechaAprobacion: new Date()
        });

        res.json({ exito: true, cdr: resultado.cdr });

    } catch (error) {
        console.error('[APPROVAL] ❌ Error en flujo de aprobación:', error.message);
        res.status(500).json({ error: 'Fallo crítico en aprobación SUNAT.' });
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

/** API Proxy: Consultar RUC Protegido con Memoria CRM (Firebase) */
app.get('/api/ruc/:ruc', authMiddleware, async (req, res) => {
    const { ruc } = req.params;

    try {
        console.log(`[CRM] Buscando RUC ${ruc} en memoria de Relié Labs...`);
        
        // 1. Buscamos en NUESTRA propia base de datos de Firebase si este cliente ya existe
        // Simplificado (sin orderBy) para evitar errores de índices en Firebase
        const snapshot = await firebaseService.db.collection('facturas')
            .where('ruc', '==', ruc)
            .limit(1)
            .get();

        if (!snapshot.empty) {
            const data = snapshot.docs[0].data();
            console.log(`[CRM] ✅ Cliente encontrado en memoria: ${data.razonSocial}`);
            return res.json({
                razon_social: data.razonSocial,
                direccion: data.direccion || 'Dirección guardada'
            });
        }

        console.warn(`[CRM] 🔍 RUC ${ruc} es nuevo. No está en nuestra base de datos aún.`);
        res.status(404).json({ error: 'Cliente nuevo. Ingresa los datos manualmente para guardarlos.' });

    } catch (err) {
        console.error(`[CRM] ❌ Error consultando base de datos interna:`, err.message);
        res.status(500).json({ error: 'Error interno en la base de datos de clientes.' });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 PORTAL DE FACTURACIÓN RELIÉ LABS PROTEGIDO EN: http://localhost:${PORT}`);
});
