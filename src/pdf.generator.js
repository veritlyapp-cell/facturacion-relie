import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import chromium from '@sparticuz/chromium';
import QRCode from 'qrcode';
import { fileURLToPath } from 'node:url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class PdfGenerator {
  /**
   * Genera la Representación Impresa (PDF) legal de SUNAT
   * @param {Object} facturaData { cliente, items, resumen, cuentasBancarias }
   * @param {Object} sunatData { rucEmisor, correlativo, serie, hash, qrCodeUrl }
   * @param {string} outputPath Salida del PDF C:/.../comprobantes/xxx.pdf
   */
  static async build(facturaData, sunatData, outputPath) {
    console.log('[PDF] Generando Representación Impresa de Factura Electrónica...');

    const { cliente, items, resumen, cuentasBancarias } = facturaData;
    const { rucEmisor, serie, correlativo, hash } = sunatData;

    // Helper para convertir números a letras (Simplificado para soles)
    const numeroALetras = (num) => {
      const unidades = ['','UN','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE'];
      const decenas = ['','DIEZ','VEINTE','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA'];
      const especiales = ['DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISEIS','DIECISIETE','DIECIOCHO','DIECINUEVE'];
      const centenas = ['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS'];

      let entero = Math.floor(num);
      let centavos = Math.round((num - entero) * 100);
      
      let letras = '';
      if (entero === 0) letras = 'CERO';
      if (entero === 100) letras = 'CIEN';
      else {
          let c = Math.floor(entero / 100);
          let d = Math.floor((entero % 100) / 10);
          let u = entero % 10;
          
          letras += centenas[c] + ' ';
          if (d === 1 && u > 0) letras += especiales[u] + ' ';
          else {
              letras += decenas[d] + (d > 0 && u > 0 ? ' Y ' : '') + unidades[u] + ' ';
          }
      }
      
      return `SON: ${letras.trim()} CON ${centavos.toString().padStart(2, '0')}/100 SOLES`;
    };

    const montoEnLetras = numeroALetras(resumen.total);

    // 1. Construir la cadena para el Código QR
    // Estándar SUNAT: RUC_EMISOR | TIPO_COMPROBANTE | SERIE | NUMERO | IGV | TOTAL | FECHA | TIPO_DOC_CLIENTE | NUM_DOC_CLIENTE
    const fechaEmision = new Date().toLocaleDateString('es-PE');
    const qrText = `${rucEmisor}|01|${serie}|${correlativo}|${resumen.igv}|${resumen.total}|${fechaEmision}|${cliente.tipoDocumento}|${cliente.numeroDocumento}|`;
    
    // 2. Generar imagen DataURL del QR
    const qrDataUrl = await QRCode.toDataURL(qrText, { margin: 1, width: 140 });

    // 3. Crear HTML/CSS de una factura bonita (tipo A4)
    const htmlTemplate = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
          body { font-family: 'Inter', sans-serif; background: #fff; color: #202e42; padding: 40px; font-size: 13px; line-height: 1.5; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; border-bottom: 2px solid #f1f5f9; padding-bottom: 20px;}
          .logo-company { font-size: 26px; font-weight: 800; color: #0f172a; margin-bottom: 5px; }
          .company-info { font-size: 12px; color: #475569; }
          .sunat-box { border: 2px solid #0f172a; border-radius: 8px; padding: 15px 30px; text-align: center; background: #fafafa;}
          .sunat-box h1 { margin: 0; font-size: 16px; font-weight: 700; text-transform: uppercase; color: #0f172a;}
          .sunat-box h2 { margin: 5px 0 0; font-size: 22px; color: #dc2626; letter-spacing: 1px;}
          
          .client-section { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
          .client-item { display: flex; flex-direction: column; }
          .client-label { font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
          .client-value { font-size: 13px; font-weight: 600; color: #0f172a; }

          table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
          thead th { background: #0f172a; color: #fff; padding: 12px; text-align: left; font-size: 12px; font-weight: 600; text-transform: uppercase;}
          tbody td { border-bottom: 1px solid #e2e8f0; padding: 12px; font-size: 13px; color: #1e293b; }
          .text-right { text-align: right; }
          
          .totals-section { display: flex; justify-content: flex-end; margin-bottom: 40px; }
          .totals-box { width: 300px; background: #f8fafc; padding: 20px; border-radius: 8px; }
          .total-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; color: #475569;}
          .total-row.grand { font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 10px; padding-top: 10px; border-top: 2px solid #cbd5e1; }

          .footer { display: flex; align-items: center; justify-content: flex-start; gap: 30px; border-top: 2px solid #f1f5f9; padding-top: 30px;}
          .qr-img { border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px; }
          .legal-text { font-size: 11px; color: #64748b; }
          .legal-text strong { color: #0f172a; display: block; margin-bottom: 5px; font-size: 12px;}
          .numero-letras {font-weight: 600; font-size: 12px; font-style: italic; margin-bottom: 20px; display: block;}
        </style>
      </head>
      <body>

        <div class="header">
          <div>
            <img src="file://${path.resolve(__dirname, 'public/assets/logo-relie.png')}" style="height: 80px; margin-bottom: 5px;" alt="Logo Relié Labs" />
            <div class="company-info">Calle San Martín 154, Int. 2, Miraflores, Lima, Perú</div>
            <div class="company-info">Mail: facturacion@relielabs.com | Tel: (+51) 987 654 321</div>
          </div>
          <div class="sunat-box">
            <h1>Factura Electrónica</h1>
            <div>RUC: ${rucEmisor}</div>
            <h2>${serie}-${correlativo}</h2>
          </div>
        </div>

        <div class="client-section">
          <div class="client-item">
            <span class="client-label">Cliente (Razón Social)</span>
            <span class="client-value">${cliente.razonSocial}</span>
          </div>
          <div class="client-item">
            <span class="client-label">RUC / DNI</span>
            <span class="client-value">${cliente.numeroDocumento}</span>
          </div>
          <div class="client-item">
            <span class="client-label">Dirección Fiscal</span>
            <span class="client-value">${cliente.direccion || '----------'}</span>
          </div>
          <div class="client-item">
            <span class="client-label">Fecha de Emisión</span>
            <span class="client-value">${fechaEmision}</span>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Cant.</th>
              <th>Cód. / UM</th>
              <th>Descripción</th>
              <th class="text-right">V. Unitario</th>
              <th class="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => `
              <tr>
                <td>${item.cantidad}</td>
                <td>${item.codigo || '-'} / ${item.unidadMedida}</td>
                <td>${item.descripcion}</td>
                <td class="text-right">${cliente.moneda || 'S/'} ${item.precioUnitario.toFixed(2)}</td>
                <td class="text-right">${cliente.moneda || 'S/'} ${(item.cantidad * item.precioUnitario).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="totals-section">
          <div class="totals-box">
            <div class="total-row">
              <span>Op. Gravadas:</span>
              <span>${cliente.moneda || 'S/'} ${resumen.subtotal.toFixed(2)}</span>
            </div>
            <div class="total-row">
              <span>IGV (18%):</span>
              <span>${cliente.moneda || 'S/'} ${resumen.igv.toFixed(2)}</span>
            </div>
            <div class="total-row grand">
              <span>Importe Total:</span>
              <span>${cliente.moneda || 'S/'} ${resumen.total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div class="numero-letras">${montoEnLetras}</div>

        <div style="margin-bottom: 30px; background: #fdf2f2; padding: 15px; border-radius: 8px; border: 1px dashed #f87171;">
          <h4 style="margin: 0 0 10px 0; color: #b91c1c; font-size: 14px; display: flex; align-items: center; gap: 8px;">
            🏦 INFORMACIÓN DE PAGO (RELIÉ LABS S.A.C.)
          </h4>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
            ${(cuentasBancarias || [
              { banco: 'BCP SOLES', nro: '191-2345678-0-12', cci: '00219100234567801256' },
              { banco: 'BBVA SOLES', nro: '0011-0123-0100045678', cci: '011-123-000100045678-01' }
            ]).map(cta => `
              <div style="font-size: 12px; color: #1e293b;">
                <strong style="display: block; color: #0f172a;">${cta.banco}:</strong>
                Cuenta: ${cta.nro}<br/>
                CCI: ${cta.cci}
              </div>
            `).join('')}
          </div>
        </div>

        <div class="footer">
          <img class="qr-img" src="${qrDataUrl}" alt="QR Factura" />
          <div class="legal-text">
            <strong>Representación impresa de la Factura Electrónica</strong>
            Podrá ser consultada en nuestro portal o en el sistema de la SUNAT.<br/>
            Autorizado mediante resolución de superintendencia N° 155-2017/SUNAT.<br/>
            Resumen Hash (Firma XML): <strong>${hash}</strong>
          </div>
        </div>

      </body>
      </html>
    `;

    // 4. Transformamos HTML a PDF elegante con Puppeteer (Bala de Plata: Chromium Empaquetado)
    let browserParams = {};

    if (process.env.RENDER || process.env.ON_RENDER) {
        console.log('[PDF] Render Detectado: Extrayendo y usando Chromium Empaquetado (@sparticuz)...');
        browserParams = {
            args: [...chromium.args, '--disable-dev-shm-usage', '--no-sandbox'],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true
        };
    } else {
        console.log('[PDF] Entorno Local Detectado: Usando Chrome por defecto...');
        browserParams = {
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        };
    }

    const browser = await puppeteer.launch(browserParams);
    const page = await browser.newPage();

    
    await page.setContent(htmlTemplate, { waitUntil: 'networkidle0' });
    
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true, // Imprime los colores de fondo CSS
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });

    await browser.close();
    console.log(`[PDF] Archivo guardado con éxito en: ${outputPath}`);
    return outputPath;
  }
}
