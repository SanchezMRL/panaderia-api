const express = require('express');
const { Pool } = require('pg');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 🔧 Función para formatear fechas a "DD/MM/YYYY"
function formatearFecha(fecha) {
  if (!fecha) return '';
  const f = new Date(fecha);
  const dia = f.getDate().toString().padStart(2, '0');
  const mes = (f.getMonth() + 1).toString().padStart(2, '0');
  const año = f.getFullYear();
  return `${dia}/${mes}/${año}`;
}

// 🔗 Conexión PostgreSQL (usando DATABASE_URL desde Render)
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 🔗 Conexión MongoDB Atlas (usando MONGO_URI desde Render)
const mongoClient = new MongoClient(process.env.MONGO_URI);
let mongoDb;

mongoClient.connect()
  .then(client => {
    mongoDb = client.db('Panaderia');
    console.log('✅ Conectado a MongoDB Atlas');
  })
  .catch(err => console.error('❌ Error conectando a MongoDB:', err));

// 🌐 Ruta raíz
app.get('/', (req, res) => {
  res.send('✅ API de Panadería en funcionamiento');
});

// 📦 Ruta: Pedido de Cliente con detalles y opinión
app.get('/pedido/cliente/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const pedido = await pgPool.query(`
      SELECT pc.*, c.nombre AS cliente_nombre, c.email AS cliente_email, e.nombre AS empleado_nombre
      FROM Pedido_Cliente pc
      JOIN Cliente c ON pc.id_cliente = c.id_cliente
      JOIN Empleado e ON pc.id_empleado = e.id_empleado
      WHERE pc.id_pedido_cliente = $1
    `, [id]);

    if (pedido.rowCount === 0) return res.json({ pedido: null });

    const detalles = await pgPool.query(`
      SELECT dpc.*, p.nombre AS producto_nombre
      FROM Detalle_Pedido_Cliente dpc
      JOIN Producto p ON dpc.id_producto = p.id_producto
      WHERE dpc.id_pedido_cliente = $1
    `, [id]);

    const opinion = await mongoDb
      .collection('opiniones_pedidos')
      .findOne({ id_pedido_cliente: id }, { projection: { _id: 0 } });

    const detallesProcesados = detalles.rows.map(d => ({
      ...d,
      precio_unitario: Number(d.precio_unitario)
    }));

    res.json({
      pedido: {
        ...pedido.rows[0],
        fecha: formatearFecha(pedido.rows[0].fecha),
        detalles: detallesProcesados
      },
      opinion: opinion
        ? { ...opinion, fecha: formatearFecha(opinion.fecha) }
        : null
    });

  } catch (err) {
    console.error('❌ Error al obtener pedido de cliente:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 🏭 Ruta: Pedido de Proveedor con detalles
app.get('/pedido/proveedor/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const pedido = await pgPool.query(`
      SELECT pp.*, pr.nombre AS proveedor_nombre, pr.email AS proveedor_email, e.nombre AS empleado_nombre
      FROM Pedido_Proveedor pp
      JOIN Proveedor pr ON pp.id_proveedor = pr.id_proveedor
      JOIN Empleado e ON pp.id_empleado = e.id_empleado
      WHERE pp.id_pedido_proveedor = $1
    `, [id]);

    if (pedido.rowCount === 0) return res.json({ pedido: null });

    const detalles = await pgPool.query(`
      SELECT dpp.*, p.nombre AS producto_nombre
      FROM Detalle_Pedido_Proveedor dpp
      JOIN Producto p ON dpp.id_producto = p.id_producto
      WHERE dpp.id_pedido_proveedor = $1
    `, [id]);

    const detallesProcesados = detalles.rows.map(d => ({
      ...d,
      coste_unitario: Number(d.coste_unitario)
    }));

    res.json({
      pedido: {
        ...pedido.rows[0],
        fecha: formatearFecha(pedido.rows[0].fecha),
        detalles: detallesProcesados
      }
    });

  } catch (err) {
    console.error('❌ Error al obtener pedido de proveedor:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 🚀 Iniciar servidor (Render usará el puerto dinámico en process.env.PORT)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 API corriendo en puerto ${PORT}`);
});

