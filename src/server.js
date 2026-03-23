import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Importar nuestros servicios profesionales
import FacturacionController from './facturacion.controller.js';
import PdfGenerator from './pdf.generator.js';
import MailService from './mail.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar Facturador
const facturador = new FacturacionController();

/**
 * Endpoint para emitir factura desde el Portal
 */
app.post('/api/emitir', async (req, res) => {
  const { ruc, razonSocial, email, items, cuentas } = req.body;

  try {
    console.log(`\n--- NUEVA SOLICITUD DE EMISIÓN: CLIENTE ${ruc} ---`);

    const clienteData = {
      tipoDocumento: '6', // RUC
      numeroDocumento: ruc,
      razonSocial: razonSocial || 'CLIENTE DESCONOCIDO',
      direccion: 'Av. Cliente, Lima',
      correlativo: '1', // Nota: Esto debe ser dinámico desde una DB en producción
      moneda: 'PEN'
    };

    // 1. Emitir a SUNAT
    const resultado = await facturador.emitirFactura(clienteData, items);

    if (!resultado.exito) {
      return res.status(400).json({ exito: false, error: resultado.error });
    }

    // 2. Generar el PDF con los bancos personalizados
    const subTotal = items.reduce((acc, el) => acc + (el.precioUnitario * el.cantidad), 0);
    const igv = subTotal * 0.18;
    const total = subTotal + igv;

    const pdfName = `20615357848-01-F001-${clienteData.correlativo}.pdf`;
    const xmlName = `20615357848-01-F001-${clienteData.correlativo}.xml`;
    const pdfPath = path.join(__dirname, '..', 'comprobantes', pdfName);
    const xmlPath = path.join(__dirname, '..', 'comprobantes', xmlName);

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

    // 3. Enviar por Correo si se proporcionó uno
    if (email && email.trim() !== '') {
      await MailService.enviarFactura(email, { serie: 'F001', correlativo: clienteData.correlativo }, [pdfPath, xmlPath]);
    }

    res.json({
      exito: true,
      cdr: resultado.cdr,
      pdf: pdfName,
      xml: xmlName
    });

  } catch (error) {
    console.error('Error procesando emisión:', error);
    res.status(500).json({ exito: false, error: 'Ocurrió un error inesperado al procesar la factura.' });
  }
});

app.listen(PORT, () => {
    console.log(`\n🚀 RELIÉ LABS BILLING PORTAL CORRIENDO: http://localhost:${PORT}`);
    console.log(`\nAccede a la URL anterior para gestionar tus facturas.\n`);
});
