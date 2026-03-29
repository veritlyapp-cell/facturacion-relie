import firebaseService from '../src/firebase.service.js';

/**
 * Script de inicialización de la Gobernanza de Relié Labs
 * Ejecutable manualmente o mediante trigger de despliegue
 */
async function seedSuperAdmin() {
    const adminUser = 'admin_oscar'; // Tu nuevo ID de Super Admin
    const adminPass = 'relie2026';  // Puedes cambiarla luego en la DB
    
    console.log(`[SEED] Creando perfil de Super Admin: ${adminUser}...`);

    try {
        await firebaseService.db.collection('users').doc(adminUser).set({
            uid: adminUser,
            displayName: 'Oscar CEO',
            role: 'super_admin',
            status: 'active',
            password: adminPass, // En entornos reales, se hashearían las contraseñas
            createdAt: new Date()
        });

        console.log('✅ Super Admin registrado con éxito en Firestore.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error inyectando usuario:', error.message);
        process.exit(1);
    }
}

seedSuperAdmin();
