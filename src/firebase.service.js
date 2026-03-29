import admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import fs from 'node:fs';
import path from 'node:path';

// Servicio de Persistencia y Estadísticas (Fase 2) para Relié Labs
class FirebaseService {
    constructor() {
        this.initialized = false;
        this.init();
    }

    init() {
        if (this.initialized) return;

        try {
            // Intentamos cargar la llave desde variable de entorno (JSON String en Render) 
            // o desde el archivo local de desarrollo
            const serviceAccount = process.env.FIREBASE_CONFIG 
                ? JSON.parse(process.env.FIREBASE_CONFIG) 
                : null;

            if (serviceAccount) {
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount),
                    storageBucket: process.env.FIREBASE_BUCKET || `${serviceAccount.project_id}.firebasestorage.app`
                });
                console.log('✅ Firebase initialized (via ENV Config)');
                this.initialized = true;
            } else if (fs.existsSync('./firebase-key.json')) {
                const key = JSON.parse(fs.readFileSync('./firebase-key.json', 'utf8'));
                admin.initializeApp({
                    credential: admin.credential.cert(key),
                    storageBucket: process.env.FIREBASE_BUCKET || `${key.project_id}.firebasestorage.app`
                });
                console.log('✅ Firebase initialized (via local key)');
                this.initialized = true;
            } else {
                console.warn('⚠️ Firebase not initialized: No config found.');
            }
        } catch (error) {
            console.error('❌ Firebase init ERROR:', error.message);
        }
    }

    get db() { return admin.firestore(); }
    get storage() { return admin.storage().bucket(); }

    /**
     * Guarda la factura como ARCHIVO PERSISTENTE y crea el registro en la DB
     * @param {Object} data { ruc, razonSocial, total, igv, items, moneda, status, createdBy }
     * @param {string} localPdfPath
     * @param {string} localXmlPath
     */
    async registrarFactura(data, localPdfPath, localXmlPath) {
        if (!this.initialized) return { error: 'Firebase not configured.' };

        const id = uuidv4();
        const dateStr = new Date().toISOString().split('T')[0];
        const monthYear = dateStr.slice(0, 7); // "2026-03" para estadísticas

        try {
            console.log(`[FIREBASE] Persistiendo factura ${id} en la nube...`);

            // 1. Subir a Firebase Storage (Persistencia real)
            const remotePdfName = `facturas/${dateStr}/${path.basename(localPdfPath)}`;
            const remoteXmlName = `facturas/${dateStr}/${path.basename(localXmlPath)}`;

            const [pdfFile] = await this.storage.upload(localPdfPath, { destination: remotePdfName, public: true });
            const [xmlFile] = await this.storage.upload(localXmlPath, { destination: remoteXmlName, public: true });

            const pdfUrl = pdfFile.publicUrl();
            const xmlUrl = xmlFile.publicUrl();

            // 2. Registrar en Firestore (Estadísticas e Historial)
            const docRef = this.db.collection('facturas').doc(id);
            const entry = {
                id,
                fecha: new Date(),
                mesAnio: monthYear,
                ruc: data.ruc,
                razonSocial: data.razonSocial,
                direccion: data.direccion || '',
                total: parseFloat(data.total),
                igv: parseFloat(data.igv),
                moneda: data.moneda || 'PEN',
                status: data.status || 'APROBADA', // Para flujo de aprobaciones
                pdfUrl,
                xmlUrl,
                items: data.items,
                creadoPor: data.createdBy || 'admin',
                clienteRef: data.ruc
            };

            await docRef.set(entry);

            // 3. Actualizar Historial del Cliente (Para la consulta de "Cuánto me compra")
            const clientRef = this.db.collection('clientes').doc(data.ruc);
            await clientRef.set({
                ruc: data.ruc,
                razonSocial: data.razonSocial,
                direccion: data.direccion || '',
                ultimaVenta: new Date(),
                numVentas: admin.firestore.FieldValue.increment(1),
                totalComprado: admin.firestore.FieldValue.increment(parseFloat(data.total))
            }, { merge: true });

            console.log(`✅ Registro ${id} guardado satisfactoriamente.`);
            return { id, pdfUrl, xmlUrl };

        } catch (error) {
            console.error('❌ Error registrando en Firebase:', error.message);
            throw error;
        }
    }

    /**
     * Obtiene el Dashboard de Estadísticas para el CEO
     */
    async getEstadisticas() {
        if (!this.initialized) return { totalFacturado: 0, numFacturas: 0 };

        const snapshot = await this.db.collection('facturas').get();
        let total = 0;
        const porCliente = {};

        snapshot.forEach(doc => {
            const f = doc.data();
            total += f.total;
            porCliente[f.ruc] = (porCliente[f.ruc] || 0) + f.total;
        });

        return {
            totalFacturado: total.toFixed(2),
            numFacturas: snapshot.size,
            topClientes: Object.entries(porCliente).sort((a,b) => b[1] - a[1]).slice(0, 5)
        };
    }
}

export default new FirebaseService();
