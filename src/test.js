import path from 'node:path';
import { fileURLToPath } from 'node:url';
import FacturacionController from './facturacion.controller.js';
import PdfGenerator from './pdf.generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function ejecutarTest() {
  console.log('--- RELIÉ LABS: INICIANDO TEST SUNAT BETA ---');
  const facturador = new FacturacionController();

  const clienteTest = {
    tipoDocumento: '6', // RUC
    numeroDocumento: '20100070970',
    razonSocial: 'SUPERMERCADOS PERUANOS S.A.',
    direccion: 'Av. Tomas Marsano 2975, Surco',
    correlativo: '1', 
    moneda: 'PEN'
  };

  const itemsTest = [
    {
      codigo: 'LIAH-001',
      descripcion: 'Suscripción Liah - Análisis y Reclutamiento IA',
      cantidad: 1,
      unidadMedida: 'ZZ', 
      precioUnitario: 500.00,
      afectacionIgv: '10' // Gravado
    }
  ];

  try {
    // 1. Emitir Factura (JSON -> XML -> Firmar -> SUNAT)
    const resultado = await facturador.emitirFactura(clienteTest, itemsTest);

    console.log('\n=== RESULTADO DE SUNAT ===');
    console.log('Estado:', resultado.cdr?.descripcion);
    console.log('Hash Firma:', resultado.hashFirma);
    
    // 2. Si el XML fue aceptado o firmado exitosamente, generar su representación impresa
    if (resultado.exito) {
      console.log('\n=== GENERACIÓN DE PDF ===');
      
      const subTotal = itemsTest.reduce((acc, el) => acc + (el.precioUnitario * el.cantidad), 0);
      const igv = subTotal * 0.18;
      const total = subTotal + igv;
      
      const pdfPath = path.join(__dirname, '..', 'comprobantes', `20615357848-01-F001-${clienteTest.correlativo}.pdf`);

      await PdfGenerator.build(
        { 
          cliente: clienteTest, 
          items: itemsTest, 
          resumen: { subtotal: subTotal, igv: igv, total: total }
        },
        { 
          rucEmisor: '20615357848', 
          serie: 'F001', 
          correlativo: clienteTest.correlativo, 
          hash: resultado.hashFirma 
        },
        pdfPath
      );
    }
    
    console.log('\n¡Todo el flujo completado!');
  } catch (error) {
    console.error('Error en la emisión:', error);
  }
}

ejecutarTest();