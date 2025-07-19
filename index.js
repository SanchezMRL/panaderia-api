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

// 📦 Ruta para reporte.html (nuevo)
app.get('/reporte.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reporte.html'));
});

// 📦 Ruta para inventario.html (opcional pero recomendado para consistencia)
app.get('/inventario.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'inventario.html'));
});

// 📦 GET: Pedido Cliente
app.get('/pedido/cliente/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const pedido = await pgPool.query(
      `SELECT pc.*, c.nombre AS cliente_nombre, c.email AS cliente_email, e.nombre AS empleado_nombre
       FROM Pedido_Cliente pc
       JOIN Cliente c ON pc.id_cliente = c.id_cliente
       JOIN Empleado e ON pc.id_empleado = e.id_empleado
       WHERE pc.id_pedido_cliente = $1`,
      [id]
    );

    if (pedido.rowCount === 0) return res.json({ pedido: null });

    const detalles = await pgPool.query(
      `SELECT dpc.*, p.nombre AS producto_nombre
       FROM Detalle_Pedido_Cliente dpc
       JOIN Producto p ON dpc.id_producto = p.id_producto
       WHERE dpc.id_pedido_cliente = $1`,
      [id]
    );

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

// 🏭 GET: Pedido Proveedor
app.get('/pedido/proveedor/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const pedido = await pgPool.query(
      `SELECT pp.*, pr.nombre AS proveedor_nombre, pr.email AS proveedor_email, e.nombre AS empleado_nombre
       FROM Pedido_Proveedor pp
       JOIN Proveedor pr ON pp.id_proveedor = pr.id_proveedor
       JOIN Empleado e ON pp.id_empleado = e.id_empleado
       WHERE pp.id_pedido_proveedor = $1`,
      [id]
    );

    if (pedido.rowCount === 0) return res.json({ pedido: null });

    const detalles = await pgPool.query(
      `SELECT dpp.*, p.nombre AS producto_nombre
       FROM Detalle_Pedido_Proveedor dpp
       JOIN Producto p ON dpp.id_producto = p.id_producto
       WHERE dpp.id_pedido_proveedor = $1`,
      [id]
    );

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

// 📥 POST: Registrar Pedido Cliente
app.post('/pedido/cliente', async (req, res) => {
  const { id_cliente, id_empleado, fecha, estado, detalles } = req.body;
  try {
    const pedido = await pgPool.query(
      `INSERT INTO Pedido_Cliente (id_cliente, id_empleado, fecha, estado)
       VALUES ($1, $2, $3, $4)
       RETURNING id_pedido_cliente`,
      [id_cliente, id_empleado, fecha, estado]
    );

    const id_pedido_cliente = pedido.rows[0].id_pedido_cliente;

    for (const d of detalles) {
      await pgPool.query(
        `INSERT INTO Detalle_Pedido_Cliente (id_pedido_cliente, id_producto, cantidad, precio_unitario)
         VALUES ($1, $2, $3, $4)`,
        [id_pedido_cliente, d.id_producto, d.cantidad, d.precio_unitario]
      );
    }

    res.json({ id_pedido_cliente });
  } catch (err) {
    console.error('❌ Error al registrar pedido de cliente:', err);
    res.status(500).json({ error: 'Error al registrar el pedido' });
  }
});

// 📥 POST: Registrar Pedido Proveedor
app.post('/pedido/proveedor', async (req, res) => {
  const { id_proveedor, id_empleado, fecha, estado, detalles } = req.body;

  try {
    // Insertar el pedido principal
    const pedido = await pgPool.query(
      `INSERT INTO Pedido_Proveedor (id_proveedor, id_empleado, fecha, estado)
       VALUES ($1, $2, $3, $4)
       RETURNING id_pedido_proveedor`,
      [id_proveedor, id_empleado, fecha, estado]
    );

    const id_pedido_proveedor = pedido.rows[0].id_pedido_proveedor;

    // Insertar cada detalle sin especificar id_detalle (deja que se autogenere)
    for (const d of detalles) {
      await pgPool.query(
        `INSERT INTO Detalle_Pedido_Proveedor (id_pedido_proveedor, id_producto, cantidad, coste_unitario)
         VALUES ($1, $2, $3, $4)`,
        [id_pedido_proveedor, d.id_producto, d.cantidad, d.coste_unitario]
      );
    }

    res.status(201).json({ mensaje: 'Pedido de proveedor registrado correctamente' });

  } catch (error) {
    console.error('❌ Error al registrar pedido a proveedor:', error);
    res.status(500).json({ error: 'Error al registrar pedido a proveedor' });
  }
});

// 🏷️ GET: Obtener precio/coste de producto
app.get('/producto/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const producto = await pgPool.query(
      `SELECT id_producto, nombre, precio_base 
       FROM Producto 
       WHERE id_producto = $1`,
      [id]
    );

    if (producto.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({
      id_producto: producto.rows[0].id_producto,
      nombre: producto.rows[0].nombre,
      precio_base: Number(producto.rows[0].precio_base)
    });

  } catch (err) {
    console.error('❌ Error al obtener producto:', err);
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});

// 💳 POST: Registrar Pago (para pedidos de cliente)
app.post('/pago', async (req, res) => {
  const { id_pedido_cliente, metodo, monto, fecha, estado } = req.body;

  // Validaciones básicas
  if (!id_pedido_cliente || !metodo || !monto) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  try {
    // Verificar que el pedido existe
    const pedidoExiste = await pgPool.query(
      'SELECT 1 FROM Pedido_Cliente WHERE id_pedido_cliente = $1',
      [id_pedido_cliente]
    );

    if (pedidoExiste.rowCount === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    // Insertar el pago en la base de datos (sin especificar id_pago)
    const resultado = await pgPool.query(
      `INSERT INTO Pago (id_pedido_cliente, metodo, monto, fecha, estado)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id_pago`,
      [
        id_pedido_cliente, 
        metodo, 
        monto, 
        fecha || new Date().toISOString(), 
        estado || 'pendiente'
      ]
    );

    // Actualizar estado del pedido si el pago está completado
    if (estado === 'completado') {
      await pgPool.query(
        'UPDATE Pedido_Cliente SET estado = $1 WHERE id_pedido_cliente = $2',
        ['pagado', id_pedido_cliente]
      );
    }

    res.status(201).json({ 
      mensaje: 'Pago registrado correctamente',
      id_pago: resultado.rows[0].id_pago
    });

  } catch (err) {
    console.error('❌ Error al registrar pago:', err);
    res.status(500).json({ error: 'Error al registrar el pago' });
  }
});

// 💳 GET: Obtener pagos por pedido
app.get('/pago/pedido/:id_pedido_cliente', async (req, res) => {
  const id_pedido_cliente = parseInt(req.params.id_pedido_cliente);

  try {
    const pagos = await pgPool.query(
      `SELECT id_pago, metodo, monto, fecha, estado
       FROM Pago
       WHERE id_pedido_cliente = $1
       ORDER BY fecha DESC`,
      [id_pedido_cliente]
    );

    res.json(pagos.rows.map(p => ({
      ...p,
      monto: Number(p.monto),
      fecha: formatearFecha(p.fecha)
    })));

  } catch (err) {
    console.error('❌ Error al obtener pagos del pedido:', err);
    res.status(500).json({ error: 'Error al obtener pagos' });
  }
});

// 🗣️ POST: Registrar Opinión
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
    console.error('❌ Error al registrar opinión en MongoDB:', err);
    res.status(500).json({ error: 'Error al guardar la opinión' });
  }
});

app.get('/dashboard/opiniones', async (req, res) => {
  try {
    const opiniones = await mongoDb.collection('opiniones_pedidos').find().toArray();

    const resultado = {};

    for (const op of opiniones) {
      const pedido = await pgPool.query(
        `SELECT dpc.id_producto, p.nombre
         FROM Detalle_Pedido_Cliente dpc
         JOIN Producto p ON dpc.id_producto = p.id_producto
         WHERE dpc.id_pedido_cliente = $1`,
        [op.id_pedido_cliente]
      );

      for (const det of pedido.rows) {
        const id = det.id_producto;
        if (!resultado[id]) {
          resultado[id] = {
            nombre: det.nombre,
            sumaCalificacion: 0,
            sumaSatisfaccion: 0,
            cantidad: 0
          };
        }

        resultado[id].sumaCalificacion += Number(op.calificacion ?? 0);
        resultado[id].sumaSatisfaccion += Number(op.satisfaccion ?? 0);
        resultado[id].cantidad += 1;
      }
    }

    const resumen = Object.values(resultado).map(prod => ({
      nombre: prod.nombre,
      promedio: (prod.sumaCalificacion / prod.cantidad).toFixed(2),
      satisfaccion: (prod.sumaSatisfaccion / prod.cantidad).toFixed(2)
    }));

    res.json(resumen);
  } catch (err) {
    console.error('❌ Error en /dashboard/opiniones:', err);
    res.status(500).json({ error: 'Error al cargar datos de opiniones' });
  }
});


// 🧾 GET: Opiniones individuales
app.get('/opiniones', async (req, res) => {
  try {
    const opiniones = await mongoDb
      .collection('opiniones_pedidos')
      .find({}, { projection: { _id: 0 } })
      .toArray();

    res.json(opiniones);
  } catch (err) {
    console.error('❌ Error al obtener opiniones:', err);
    res.status(500).json({ error: 'Error al obtener opiniones' });
  }
});

// 📦 GET: Inventario
app.get('/inventario', async (req, res) => {
  try {
    const result = await pgPool.query(`
      SELECT 
        i.id_producto, 
        p.nombre, 
        p.categoria, 
        p.unidad_medida, 
        i.cantidad, 
        i.ultima_actualizacion
      FROM inventario i
      JOIN producto p ON i.id_producto = p.id_producto
    `);

    const inventario = result.rows;
    res.json(inventario);
  } catch (err) {
    console.error('❌ Error al obtener inventario:', err);
    res.status(500).json({ error: 'Error al obtener el inventario' });
  }
});

app.get('/inventario', async (req, res) => {
  try {
    const result = await pgPool.query(`
      SELECT 
        i.id_producto, 
        p.nombre, 
        p.categoria, 
        p.unidad_medida, 
        i.cantidad, 
        i.ultima_actualizacion
      FROM inventario i
      JOIN producto p ON i.id_producto = p.id_producto
    `);

    const inventario = result.rows;
    res.json(inventario);
  } catch (err) {
    console.error('❌ Error al obtener inventario:', err);
    res.status(500).json({ error: 'Error al obtener el inventario' });
  }
});

// 📊 GET: Reporte de Ventas (para reporte.html)
app.get('/reportes/ventas', async (req, res) => {
  try {
    const totalVentas = await pgPool.query(`
      SELECT SUM(monto) as total 
      FROM Pago 
      WHERE estado = 'Pagado'
    `);

    const clientesTotales = await pgPool.query(`
      SELECT COUNT(DISTINCT pc.id_cliente) as total
      FROM Pedido_Cliente pc
      JOIN Pago p ON pc.id_pedido_cliente = p.id_pedido_cliente
      WHERE p.estado = 'Pagado'
    `);

    const pedidosTotales = await pgPool.query(`
      SELECT COUNT(*) as total
      FROM Pedido_Cliente pc
      JOIN Pago p ON pc.id_pedido_cliente = p.id_pedido_cliente
      WHERE p.estado = 'Pagado'
    `);

    const metodos = await pgPool.query(`
      SELECT metodo, COUNT(*) as cantidad
      FROM Pago
      WHERE estado = 'Pagado'
      GROUP BY metodo
    `);

    res.json({
      total_ventas: parseFloat(totalVentas.rows[0].total || 0),
      clientes_hoy: parseInt(clientesTotales.rows[0].total || 0),
      pedidos_hoy: parseInt(pedidosTotales.rows[0].total || 0),
      metodos_pago: metodos.rows
    });

  } catch (err) {
    console.error('❌ Error en /reportes/ventas:', err);
    res.status(500).json({ error: 'Error al obtener reporte de ventas' });
  }
});

// Total acumulado de ventas
app.get('/api/reportes/total_ventas', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT COALESCE(SUM(monto), 0) AS total_ventas FROM Pago');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error en total_ventas:', err);
    res.status(500).json({ error: 'Error al obtener total de ventas' });
  }
});

// Métodos de pago y cantidad de uso
app.get('/api/reportes/metodos_pago', async (req, res) => {
  try {
    const result = await pgPool.query(`
      SELECT metodo, COUNT(*) AS cantidad_usos
      FROM Pago
      GROUP BY metodo
      ORDER BY cantidad_usos DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error en metodos_pago:', err);
    res.status(500).json({ error: 'Error al obtener métodos de pago' });
  }
});

// 📦 GET: Obtener todas las entregas
app.get('/entregas', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT * FROM Entrega ORDER BY fecha_entrega DESC');
    
    // Opcional: formatear fecha antes de enviar
    const entregasFormateadas = result.rows.map(entrega => ({
      ...entrega,
      fecha_entrega: formatearFecha(entrega.fecha_entrega)
    }));

    res.json(entregasFormateadas);
  } catch (err) {
    console.error('❌ Error al obtener entregas:', err);
    res.status(500).json({ error: 'Error al obtener entregas' });
  }
});

// POST: Agregar Cliente
app.post('/cliente', async (req, res) => {
  const { nombre, direccion, telefono, email } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }

  try {
    const resultado = await pgPool.query(
      `INSERT INTO Cliente (nombre, direccion, telefono, email)
       VALUES ($1, $2, $3, $4)
       RETURNING id_cliente`,
      [nombre, direccion || null, telefono || null, email || null]
    );

    res.status(201).json({ 
      mensaje: 'Cliente agregado correctamente', 
      id_cliente: resultado.rows[0].id_cliente 
    });
  } catch (error) {
    console.error('Error al agregar cliente:', error);
    res.status(500).json({ error: 'Error al agregar cliente' });
  }
});

// POST: Agregar Proveedor
app.post('/proveedor', async (req, res) => {
  const { nombre, direccion, telefono, email } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }

  try {
    const resultado = await pgPool.query(
      `INSERT INTO Proveedor (nombre, direccion, telefono, email)
       VALUES ($1, $2, $3, $4)
       RETURNING id_proveedor`,
      [nombre, direccion || null, telefono || null, email || null]
    );

    res.status(201).json({ 
      mensaje: 'Proveedor agregado correctamente', 
      id_proveedor: resultado.rows[0].id_proveedor 
    });
  } catch (error) {
    console.error('Error al agregar proveedor:', error);
    res.status(500).json({ error: 'Error al agregar proveedor' });
  }
});


// Total de pedidos
app.get('/api/reportes/total_pedidos', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT COUNT(*) AS total_pedidos FROM Pedido_Cliente');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error en total_pedidos:', err);
    res.status(500).json({ error: 'Error al obtener total de pedidos' });
  }
});

// Clientes únicos que han hecho pedidos
app.get('/api/reportes/clientes_atendidos', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT COUNT(DISTINCT id_cliente) AS clientes_atendidos FROM Pedido_Cliente');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error en clientes_atendidos:', err);
    res.status(500).json({ error: 'Error al obtener clientes atendidos' });
  }
});

// 👥 GET: Obtener todos los clientes
app.get('/clientes', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT * FROM Cliente ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error al obtener clientes:', err);
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
});

// 🏭 GET: Obtener todos los proveedores
app.get('/proveedores', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT * FROM Proveedor ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error al obtener proveedores:', err);
    res.status(500).json({ error: 'Error al obtener proveedores' });
  }
});

// 👤 GET: Obtener un cliente específico por ID
app.get('/cliente/:id', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT * FROM Cliente WHERE id_cliente = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error al obtener cliente:', err);
    res.status(500).json({ error: 'Error al obtener cliente' });
  }
});

// 🏢 GET: Obtener un proveedor específico por ID
app.get('/proveedor/:id', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT * FROM Proveedor WHERE id_proveedor = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error al obtener proveedor:', err);
    res.status(500).json({ error: 'Error al obtener proveedor' });
  }
});

// 🚀 Puerto para Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 API corriendo en puerto ${PORT}`);
});
