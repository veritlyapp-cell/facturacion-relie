import { Resend } from 'resend';
import path from 'node:path';
import fs from 'node:fs';

export default class MailService {
  /**
   * Envia la Factura (PDF + XML) al cliente
   * @param {string} emailDestino 
   * @param {Object} facturaData { serie, correlativo }
   * @param {Array<string>} adjuntos Rutas absolutas a los archivos
   */
  static async enviarFactura(emailDestino, facturaData, adjuntos) {
    console.log(`[MAIL] Preparando envío con RESEND API a: ${emailDestino}...`);

    // Inyectamos la API Key que me enviaste o la tomamos del entorno
    const resend = new Resend(process.env.RESEND_API_KEY || 're_UGSCcZDk_645vnknvPPV5ULru3noTuYLo');

    try {
      // 1. Transformar rutas absolutas a Buffers para Resend
      const attachmentsForResend = adjuntos.map(filePath => {
        const fileData = fs.readFileSync(filePath);
        return {
          filename: path.basename(filePath),
          content: fileData
        };
      });

      // 2. Ejecutar envío a través del puerto 443 (HTTP/s) para eludir el bloqueo de Render
      const { data, error } = await resend.emails.send({
        // Si tienes verificado 'notreply.getliah.com', puedes cambiar "facturacion@relielabs.com" por "notreply..."
        // Pero idealmente mantenlo así si ya validaste relielabs.com en tu panel de Resend:
        from: 'Facturación Relié Labs <facturacion@relielabs.com>',
        to: [emailDestino],
        subject: `Factura Electrónica ${facturaData.serie}-${facturaData.correlativo} - Relié Labs S.A.C.`,
        html: `
          <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
            <h2 style="color: #0f172a;">Estimado Cliente,</h2>
            <p>Adjuntamos el comprobante de pago electrónico correspondiente a su reciente adquisición con <strong>Relié Labs S.A.C.</strong></p>
            
            <div style="background: #f8fafc; padding: 15px; border-left: 4px solid #0f172a; margin: 20px 0;">
              <strong>Detalles del Comprobante:</strong><br/>
              Factura: ${facturaData.serie}-${facturaData.correlativo}<br/>
              Emisor: Relié Labs S.A.C.<br/>
              RUC: 20615357848
            </div>

            <p>Este correo incluye el archivo <strong>XML</strong> (legal) y el <strong>PDF</strong> (representación impresa).</p>
            
            <p style="font-size: 12px; color: #666; border-top: 1px solid #eee; padding-top: 10px; margin-top: 30px;">
              Gracias por confiar en Relié Labs.<br/>
              <em>Este es un correo automático, por favor no responda.</em>
            </p>
          </div>
        `,
        attachments: attachmentsForResend
      });

      if (error) {
        console.error('[MAIL] ❌ Error de la API de Resend:', error);
        return false;
      }

      console.log(`[MAIL] ✅ Factura disparada exitosamente a través de Resend (ID: ${data.id})`);
      return true;

    } catch (error) {
      console.error('[MAIL] ❌ Excepción fatal enviando correo por Resend:', error.message);
      return false;
    }
  }
}
