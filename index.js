const express = require('express');
const { Pool } = require('pg');
const { MongoClient } = require('mongodb');
const cors = require('cors');
require('dotenv').config(); // Para usar .env si lo usas localmente también

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Asegúrate de tener la carpeta "public"

// 🔧 Función para formatear fechas a "DD/MM/YYYY"
function formatearFecha(fecha) {
  if (!fecha) return '';
  const f = new Date(fecha);
  const dia = f.getDate().toString().padStart(2, '0');
  const mes = (f.getMonth() + 1).toString().padStart(2, '0');
  const año = f.getFullYear();
  return `${dia}/${mes}/${año}`;
}

// 🔗 Conexión PostgreSQL (Render define DATABASE_URL como variable de entorno)
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 🔗 Conexión MongoDB Atlas
const mongoClient = new MongoClient(process.env.MONGO_URI);
let mongoDb;

mongoClient.connect()
  .then(client => {
    mongoDb = client.db('Panaderia');
    console.log('✅ Conectado a MongoDB Atlas');
  })
  .catch(err => console.error('❌ Error conectando a MongoDB:', err));

// 🌐 Ruta base
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/inicio.html'); // Servir página de inicio
});

// 📦 Pedido Cliente + detalles + opinión
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

    const opinion = await mongoDb.collection('opiniones_pedidos').findOne(
      { id_pedido_cliente: id },
      { projection: { _id: 0 } }
    );

    res.json({
      pedido: {
        ...pedido.rows[0],
        fecha: formatearFecha(pedido.rows[0].fecha),
        detalles: detalles.rows.map(d => ({
          ...d,
          precio_unitario: Number(d.precio_unitario)
        }))
      },
      opinion: opinion
        ? { ...opinion, fecha: formatearFecha(opinion.fecha) }
        : null
    });

  } catch (err) {
    console.error('❌ Error obteniendo pedido cliente:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 🏭 Pedido Proveedor + detalles
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

    res.json({
      pedido: {
        ...pedido.rows[0],
        fecha: formatearFecha(pedido.rows[0].fecha),
        detalles: detalles.rows.map(d => ({
          ...d,
          coste_unitario: Number(d.coste_unitario)
        }))
      }
    });

  } catch (err) {
    console.error('❌ Error obteniendo pedido proveedor:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 📥 Opinión
app.post('/opinion', async (req, res) => {
  const { id_pedido_cliente, comentario, calificacion, satisfaccion, fecha } = req.body;

  try {
    await mongoDb.collection('opiniones_pedidos').insertOne({
      id_pedido_cliente,
      comentario,
      calificacion,
      satisfaccion,
      fecha: new Date(fecha)
    });

    res.json({ mensaje: 'Opinión guardada' });

  } catch (err) {
    console.error('❌ Error guardando opinión:', err);
    res.status(500).json({ error: 'Error al guardar opinión' });
  }
});

// 📊 Obtener todas las opiniones
app.get('/opiniones', async (req, res) => {
  try {
    const opiniones = await mongoDb.collection('opiniones_pedidos').find().toArray();
    res.json(opiniones);
  } catch (err) {
    console.error('❌ Error obteniendo opiniones:', err);
    res.status(500).json({ error: 'Error al obtener opiniones' });
  }
});

// 📊 Dashboard de calificación por producto
app.get('/dashboard/opiniones', async (req, res) => {
  try {
    const opiniones = await mongoDb.collection('opiniones_pedidos').find().toArray();
    const resultados = {};

    for (const opinion of opiniones) {
      const detalles = await pgPool.query(`
        SELECT dpc.id_producto, p.nombre
        FROM Detalle_Pedido_Cliente dpc
        JOIN Producto p ON dpc.id_producto = p.id_producto
        WHERE dpc.id_pedido_cliente = $1
      `, [opinion.id_pedido_cliente]);

      for (const d of detalles.rows) {
        if (!resultados[d.id_producto]) {
          resultados[d.id_producto] = {
            nombre: d.nombre,
            total: 0,
            cantidad: 0
          };
        }
        resultados[d.id_producto].total += opinion.calificacion;
        resultados[d.id_producto].cantidad++;
      }
    }

    const ranking = Object.entries(resultados).map(([id, val]) => ({
      id_producto: id,
      nombre: val.nombre,
      promedio: (val.total / val.cantidad).toFixed(2)
    })).sort((a, b) => b.promedio - a.promedio);

    res.json(ranking);
  } catch (err) {
    console.error('❌ Error dashboard opiniones:', err);
    res.status(500).json({ error: 'Error procesando dashboard' });
  }
});

// 🚀 Puerto para Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 API corriendo en puerto ${PORT}`);
});
