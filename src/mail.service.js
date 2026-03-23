import nodemailer from 'nodemailer';
import path from 'node:path';

export default class MailService {
  /**
   * Envia la Factura (PDF + XML) al cliente
   * @param {string} emailDestino 
   * @param {Object} facturaData { serie, correlativo }
   * @param {Array<string>} adjuntos Rutas absolutas a los archivos
   */
  static async enviarFactura(emailDestino, facturaData, adjuntos) {
    console.log(`[MAIL] Preparando envío a: ${emailDestino}...`);

    // Configuración de transporte (Ejemplo usando Variables de Entorno)
    // Para producción usa SendGrid, Amazon SES o Gmail App Password
    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST || 'smtp.gmail.com',
      port: process.env.MAIL_PORT || 465,
      secure: true, 
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
      }
    });

    try {
      const info = await transporter.sendMail({
        from: `"Facturación Relié Labs" <${process.env.MAIL_USER}>`,
        to: emailDestino,
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
        attachments: adjuntos.map(filePath => ({
          filename: path.basename(filePath),
          path: filePath
        }))
      });

      console.log(`[MAIL] Factura enviada con éxito: ${info.messageId}`);
      return true;
    } catch (error) {
      console.error('[MAIL] Error enviando correo:', error);
      // No lanzamos error para no detener el proceso de flujo, pero retornamos false
      return false;
    }
  }
}
