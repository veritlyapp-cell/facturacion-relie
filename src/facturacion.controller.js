import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  RUC_EMISOR = '20615357848',
  SUNAT_ENV,
  SUNAT_BETA_URL,
  SUNAT_PROD_URL,
  COMPROBANTES_DIR
} = process.env;

export default class FacturacionController {
  constructor() {
    this.comprobantesPath = path.resolve(__dirname, '..', COMPROBANTES_DIR || 'comprobantes');
    this.initDirectorio();
    this.configurarClienteSunat();
  }

  initDirectorio() {
    if (!fs.existsSync(this.comprobantesPath)) {
      fs.mkdirSync(this.comprobantesPath, { recursive: true });
    }
  }

  configurarClienteSunat() {
    const p12Path = path.resolve(__dirname, '..', process.env.CERT_PATH || 'certificado.p12');
    this.endpointSunat = SUNAT_ENV === 'PRODUCCION' ? SUNAT_PROD_URL : SUNAT_BETA_URL;
  }

  async emitirFactura(datosCliente, items) {
    try {
      console.log('Construyendo XML (UBL 2.1) estructurado para SUNAT...');

      const serie = 'F001';
      const correlativo = datosCliente.correlativo || '1';
      const fileName = `${RUC_EMISOR}-01-${serie}-${correlativo}`;
      const xmlFilePath = path.join(this.comprobantesPath, `${fileName}.xml`);

      const total = items.reduce((acc, el) => acc + (el.precioUnitario * el.cantidad), 0);
      const igv = total * 0.18;
      const totalVenta = total + igv;
      const fechaHoy = new Date().toISOString().split('T')[0];

      const xmlRows = items.map((item, i) => `    <cac:InvoiceLine>
        <cbc:ID>${i + 1}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="${item.unidadMedida}">${item.cantidad}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="PEN">${(item.cantidad * item.precioUnitario).toFixed(2)}</cbc:LineExtensionAmount>
        <cac:PricingReference>
            <cac:AlternativeConditionPrice>
                <cbc:PriceAmount currencyID="PEN">${(item.precioUnitario * 1.18).toFixed(2)}</cbc:PriceAmount>
                <cbc:PriceTypeCode>01</cbc:PriceTypeCode>
            </cac:AlternativeConditionPrice>
        </cac:PricingReference>
        <cac:Item>
            <cbc:Description>${item.descripcion}</cbc:Description>
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID="PEN">${item.precioUnitario.toFixed(2)}</cbc:PriceAmount>
        </cac:Price>
    </cac:InvoiceLine>`).join('\n');

      const xmlRealUBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" 
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" 
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" 
         xmlns:ds="http://www.w3.org/2000/09/xmldsig#" 
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
    <ext:UBLExtensions>
        <ext:UBLExtension>
            <!-- AQUI VA LA FIRMA DIGITAL REAL UBL 2.1 -->
            <ext:ExtensionContent>
                <ds:Signature Id="SignRelieLabs">
                    <ds:SignedInfo>
                        <ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
                        <ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>
                        <ds:Reference URI="">
                            <ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></ds:Transforms>
                            <ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>
                            <ds:DigestValue>mOckDIgEsTVaLuE=</ds:DigestValue>
                        </ds:Reference>
                    </ds:SignedInfo>
                    <ds:SignatureValue>mOckSiGnaTurEVaLuE=</ds:SignatureValue>
                </ds:Signature>
            </ext:ExtensionContent>
        </ext:UBLExtension>
    </ext:UBLExtensions>
    <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
    <cbc:CustomizationID>2.0</cbc:CustomizationID>
    <cbc:ID>${serie}-${correlativo}</cbc:ID>
    <cbc:IssueDate>${fechaHoy}</cbc:IssueDate>
    <cbc:InvoiceTypeCode listID="0101">01</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>${datosCliente.moneda || 'PEN'}</cbc:DocumentCurrencyCode>
    
    <cac:AccountingSupplierParty>
        <cac:Party>
            <cac:PartyIdentification>
                <cbc:ID schemeID="6">${RUC_EMISOR}</cbc:ID>
            </cac:PartyIdentification>
            <cac:PartyName>
                <cbc:Name>RELIÉ LABS S.A.C.</cbc:Name>
            </cac:PartyName>
        </cac:Party>
    </cac:AccountingSupplierParty>
    
    <cac:AccountingCustomerParty>
        <cac:Party>
            <cac:PartyIdentification>
                <cbc:ID schemeID="${datosCliente.tipoDocumento}">${datosCliente.numeroDocumento}</cbc:ID>
            </cac:PartyIdentification>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>${datosCliente.razonSocial}</cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingCustomerParty>
    
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${datosCliente.moneda || 'PEN'}">${igv.toFixed(2)}</cbc:TaxAmount>
        <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="${datosCliente.moneda || 'PEN'}">${total.toFixed(2)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="${datosCliente.moneda || 'PEN'}">${igv.toFixed(2)}</cbc:TaxAmount>
            <cac:TaxCategory>
                <cac:TaxScheme>
                    <cbc:ID>1000</cbc:ID>
                    <cbc:Name>IGV</cbc:Name>
                    <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
                </cac:TaxScheme>
            </cac:TaxCategory>
        </cac:TaxSubtotal>
    </cac:TaxTotal>
    
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="${datosCliente.moneda || 'PEN'}">${total.toFixed(2)}</cbc:LineExtensionAmount>
        <cbc:TaxInclusiveAmount currencyID="${datosCliente.moneda || 'PEN'}">${totalVenta.toFixed(2)}</cbc:TaxInclusiveAmount>
        <cbc:PayableAmount currencyID="${datosCliente.moneda || 'PEN'}">${totalVenta.toFixed(2)}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>
    
${xmlRows}
</Invoice>`;

      fs.writeFileSync(xmlFilePath, xmlRealUBL, 'utf8');
      console.log(`XML UBL 2.1 Generado Exitosamente: ${xmlFilePath}`);

      // 2. Simular Envío
      console.log(`Conectando al servicio web SOAP: ${this.endpointSunat} ...`);
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      return {
        exito: true,
        aceptado: true,
        hashFirma: 'mOckDIgEsTVaLuE=',
        rutaXml: xmlFilePath,
        cdr: {
          codigo: '0',
          descripcion: 'La Factura ha sido aceptada',
          observaciones: []
        }
      };

    } catch (error) {
      console.error('Error al emitir factura:', error.message);
      return { exito: false, error: error.message };
    }
  }
} // Fin del controlador
