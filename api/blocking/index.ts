import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../lib/db.js';
import { createHash } from 'crypto';

/** Hash SHA-256 para contraseñas de clientes del módulo de bloqueo */
function hashPwd(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = req.query.path || '';
  const db = await getDb();

  // ─────────────────────────────────────────────────
  // DEVICES
  // ─────────────────────────────────────────────────
  if (path === 'devices' || !path) {
    const collection = db.collection('blocking_devices');

    if (req.method === 'GET') {
      try {
        const devices = await collection.find({}).toArray();
        return res.json(devices);
      } catch (error) {
        return res.status(500).json({ error: 'Error fetching devices' });
      }
    }

    if (req.method === 'POST') {
      try {
        const { imei, brand, model, phoneNumber, owner, email, telefono, paymentPlan } = req.body || {};

        // Validación básica
        if (!imei || !brand || !model || !owner) {
          return res.status(400).json({ error: 'IMEI, marca, modelo y propietario son requeridos' });
        }

        // Verificar IMEI duplicado
        const existing = await collection.findOne({ imei });
        if (existing) {
          return res.status(400).json({ error: 'Ya existe un dispositivo con ese IMEI' });
        }

        let devicePaymentPlan = null;
        if (paymentPlan && paymentPlan.totalAmount > 0) {
          const nextPaymentDate = new Date();
          if (paymentPlan.paymentFrequency === 'weekly') {
            nextPaymentDate.setDate(nextPaymentDate.getDate() + 7);
          } else if (paymentPlan.paymentFrequency === 'biweekly') {
            nextPaymentDate.setDate(nextPaymentDate.getDate() + 15);
          } else {
            nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
          }

          devicePaymentPlan = {
            id: `pp_${Date.now()}`,
            deviceId: '',
            totalAmount: paymentPlan.totalAmount,
            paidAmount: 0,
            remainingAmount: paymentPlan.totalAmount,
            totalPayments: paymentPlan.totalPayments || 4,
            completedPayments: 0,
            paymentFrequency: paymentPlan.paymentFrequency || 'monthly',
            paymentAmount: paymentPlan.paymentAmount || Math.round(paymentPlan.totalAmount / (paymentPlan.totalPayments || 4)),
            startDate: new Date().toISOString(),
            nextPaymentDate: nextPaymentDate.toISOString(),
            status: 'active',
            paymentMethods: ['efectivo', 'transferencia', 'pago_movil'],
          };
        }

        const device = {
          imei, brand, model, phoneNumber, owner,
          email: email || '',
          status: 'active',
          createdAt: new Date().toISOString(),
          enrolledInMDM: true,
          lastSync: new Date().toISOString(),
          location: null, batteryLevel: null,
          androidVersion: null, securityPatchLevel: null, osVersion: null,
          kioskMode: { enabled: false, allowedApps: [], allowEmergencyCalls: true },
          contract: null,
          paymentPlan: devicePaymentPlan,
        };

        const result = await collection.insertOne(device);
        (device as any)._id = result.insertedId;

        if (devicePaymentPlan) {
          device.paymentPlan!.deviceId = result.insertedId.toString();
          await collection.updateOne(
            { _id: result.insertedId },
            { $set: { paymentPlan: device.paymentPlan } }
          );
        }

        // Crear cliente si tiene email — con contraseña HASHEADA
        if (email && owner) {
          const clientesCollection = db.collection('blocking_clientes');
          const clienteExistente = await clientesCollection.findOne({ email });

          if (!clienteExistente) {
            const tempPasswordPlain = telefono ? `${telefono.slice(-4)}123` : 'xiao2024';
            await clientesCollection.insertOne({
              email,
              password: hashPwd(tempPasswordPlain),  // ← guardado como hash
              passwordPlainForDisplay: tempPasswordPlain, // ← temporal, para que admin pueda comunicársela
              nombre: owner,
              telefono: telefono || '',
              createdAt: new Date().toISOString(),
            });
            (device as any).clientCreated = true;
            (device as any).clientPassword = tempPasswordPlain; // sólo en respuesta, no en BD
          }
        }

        return res.json(device);
      } catch (error) {
        console.error('[blocking] Error creating device:', error);
        return res.status(500).json({ error: 'Error creating device' });
      }
    }

    if (req.method === 'PUT') {
      try {
        const { id, action, reason, allowedApps } = req.body || {};
        if (!id) return res.status(400).json({ error: 'ID requerido' });

        const { ObjectId } = await import('mongodb');
        let objectId: any;
        try {
          objectId = new ObjectId(id);
        } catch {
          return res.status(400).json({ error: 'ID inválido' });
        }

        let updateDoc: any = null;

        if (action === 'block') {
          updateDoc = { $set: { status: 'blocked', blockedAt: new Date().toISOString(), reason: reason || null } };
        } else if (action === 'unblock') {
          updateDoc = { $set: { status: 'active' }, $unset: { blockedAt: '', reason: '' } };
        } else if (action === 'kiosk_enable') {
          updateDoc = { $set: { status: 'kiosk', kioskMode: { enabled: true, allowedApps: allowedApps || [], allowEmergencyCalls: true, exitPin: '1234' } } };
        } else if (action === 'kiosk_disable') {
          updateDoc = { $set: { status: 'active', kioskMode: { enabled: false, allowedApps: [], allowEmergencyCalls: true } } };
        } else {
          return res.status(400).json({ error: 'Acción inválida' });
        }

        // MongoDB Driver v7: findOneAndUpdate retorna el documento directamente (no .value)
        const updatedDevice = await collection.findOneAndUpdate(
          { _id: objectId },
          updateDoc,
          { returnDocument: 'after' }
        );

        if (!updatedDevice) {
          return res.status(404).json({ error: 'Dispositivo no encontrado' });
        }

        return res.json(updatedDevice);
      } catch (error) {
        console.error('[blocking] Error updating device:', error);
        return res.status(500).json({ error: 'Error updating device' });
      }
    }

    if (req.method === 'DELETE') {
      try {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'ID requerido' });

        const { ObjectId } = await import('mongodb');
        let objectId: any;
        try {
          objectId = new ObjectId(id as string);
        } catch {
          return res.status(400).json({ error: 'ID inválido' });
        }

        const result = await collection.deleteOne({ _id: objectId });
        if (result.deletedCount === 0) {
          return res.status(404).json({ error: 'Dispositivo no encontrado' });
        }
        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({ error: 'Error deleting device' });
      }
    }
  }

  // ─────────────────────────────────────────────────
  // HISTORY
  // ─────────────────────────────────────────────────
  if (path === 'history') {
    const collection = db.collection('blocking_history');

    if (req.method === 'GET') {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const history = await collection.find({}).sort({ timestamp: -1 }).limit(limit).toArray();
        return res.json(history);
      } catch (error) {
        return res.status(500).json({ error: 'Error fetching history' });
      }
    }

    if (req.method === 'POST') {
      try {
        const { deviceId, action, user, reason, deviceInfo, metadata } = req.body || {};
        if (!deviceId || !action) {
          return res.status(400).json({ error: 'deviceId y action son requeridos' });
        }
        const entry = {
          deviceId, action,
          user: user || 'Admin',
          reason: reason || null,
          deviceInfo, metadata: metadata || null,
          timestamp: new Date().toISOString(),
        };
        await collection.insertOne(entry);
        return res.json(entry);
      } catch (error) {
        return res.status(500).json({ error: 'Error creating history entry' });
      }
    }
  }

  // ─────────────────────────────────────────────────
  // DATA (alerts & payments)
  // ─────────────────────────────────────────────────
  if (path === 'data') {
    const alertsCollection = db.collection('blocking_alerts');
    const paymentsCollection = db.collection('blocking_payments');

    if (req.method === 'GET') {
      try {
        const type = req.query.type as string;

        if (type === 'alerts') {
          const alerts = await alertsCollection.find({}).sort({ timestamp: -1 }).limit(50).toArray();
          return res.json(alerts);
        }

        if (type === 'payments') {
          const deviceId = req.query.deviceId as string;
          const query = deviceId ? { deviceId } : {};
          const payments = await paymentsCollection.find(query).sort({ date: -1 }).toArray();
          return res.json(payments);
        }

        return res.status(400).json({ error: 'Tipo inválido. Use: alerts | payments' });
      } catch (error) {
        return res.status(500).json({ error: 'Error fetching data' });
      }
    }

    if (req.method === 'POST') {
      try {
        const { type, data } = req.body || {};
        const { ObjectId } = await import('mongodb');

        if (type === 'alert') {
          const alert = { ...data, acknowledged: false, timestamp: new Date().toISOString() };
          await alertsCollection.insertOne(alert);
          return res.json(alert);
        }

        if (type === 'payment') {
          const { deviceId, amount, method } = data || {};
          if (!deviceId || !amount) {
            return res.status(400).json({ error: 'deviceId y amount son requeridos' });
          }

          const devicesCollection = db.collection('blocking_devices');
          let objectId: any;
          try {
            objectId = new ObjectId(deviceId);
          } catch {
            return res.status(400).json({ error: 'deviceId inválido' });
          }

          const device = await devicesCollection.findOne({ _id: objectId });

          if (!device || !device.paymentPlan) {
            return res.status(400).json({ error: 'Dispositivo o plan de pagos no encontrado' });
          }

          const payment = {
            ...data,
            status: 'completed',
            date: new Date().toISOString(),
            receiptNumber: `REC-${Date.now()}`,
          };
          await paymentsCollection.insertOne(payment);

          const newPaidAmount = device.paymentPlan.paidAmount + amount;
          const newRemainingAmount = device.paymentPlan.totalAmount - newPaidAmount;
          const newCompletedPayments = device.paymentPlan.completedPayments + 1;
          const isCompleted = newRemainingAmount <= 0;

          const nextPaymentDate = new Date();
          if (device.paymentPlan.paymentFrequency === 'weekly') {
            nextPaymentDate.setDate(nextPaymentDate.getDate() + 7);
          } else if (device.paymentPlan.paymentFrequency === 'biweekly') {
            nextPaymentDate.setDate(nextPaymentDate.getDate() + 15);
          } else {
            nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
          }

          await devicesCollection.updateOne(
            { _id: objectId },
            {
              $set: {
                paymentPlan: {
                  ...device.paymentPlan,
                  paidAmount: newPaidAmount,
                  remainingAmount: Math.max(0, newRemainingAmount),
                  completedPayments: newCompletedPayments,
                  status: isCompleted ? 'completed' : 'active',
                  nextPaymentDate: nextPaymentDate.toISOString(),
                },
              },
            }
          );

          if (isCompleted) {
            await alertsCollection.insertOne({
              deviceId,
              type: 'payment_completed',
              message: `¡Plan de pagos completado! ${device.brand} ${device.model}`,
              timestamp: new Date().toISOString(),
              acknowledged: false,
            });
          }

          return res.json(payment);
        }

        if (type === 'acknowledge_alert') {
          const { ObjectId: ObjId } = await import('mongodb');
          await alertsCollection.updateOne(
            { _id: new ObjId(data.id) },
            { $set: { acknowledged: true } }
          );
          return res.json({ success: true });
        }

        return res.status(400).json({ error: 'Tipo inválido' });
      } catch (error) {
        console.error('[blocking/data] Error:', error);
        return res.status(500).json({ error: 'Error creating record' });
      }
    }
  }

  // ─────────────────────────────────────────────────
  // CLIENT LOGIN
  // ─────────────────────────────────────────────────
  if (path === 'client/login') {
    if (req.method === 'POST') {
      try {
        const { email, password } = req.body || {};

        if (!email || !password) {
          return res.status(400).json({ error: 'Email y contraseña son requeridos' });
        }

        const clientesCollection = db.collection('blocking_clientes');

        // Soportar contraseñas hasheadas y texto plano (legacy)
        const hashedPwd = hashPwd(password);
        const cliente = await clientesCollection.findOne({
          email,
          $or: [{ password: hashedPwd }, { password }],
        });

        if (!cliente) {
          return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const { password: _, passwordPlainForDisplay: __, ...clienteSinPassword } = cliente;
        return res.json({ success: true, cliente: clienteSinPassword });
      } catch (error) {
        return res.status(500).json({ error: 'Error en el login' });
      }
    }
  }

  // ─────────────────────────────────────────────────
  // CLIENT REGISTER
  // ─────────────────────────────────────────────────
  if (path === 'client/register') {
    if (req.method === 'POST') {
      try {
        const { email, password, nombre, telefono } = req.body || {};

        if (!email || !password || !nombre) {
          return res.status(400).json({ error: 'Email, contraseña y nombre son requeridos' });
        }

        if (password.length < 6) {
          return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }

        const clientesCollection = db.collection('blocking_clientes');
        const existente = await clientesCollection.findOne({ email });

        if (existente) {
          return res.status(400).json({ error: 'El email ya está registrado' });
        }

        const nuevoCliente = {
          email,
          password: hashPwd(password), // ← siempre hasheado
          nombre,
          telefono: telefono || '',
          createdAt: new Date().toISOString(),
        };

        await clientesCollection.insertOne(nuevoCliente);
        const { password: _, ...clienteSinPassword } = nuevoCliente;

        return res.json({ success: true, cliente: clienteSinPassword });
      } catch (error) {
        return res.status(500).json({ error: 'Error al registrar cliente' });
      }
    }
  }

  // ─────────────────────────────────────────────────
  // CLIENT DEVICES
  // ─────────────────────────────────────────────────
  if (path === 'client/devices') {
    if (req.method === 'GET') {
      try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
          return res.status(401).json({ error: 'No autorizado' });
        }

        let cliente: any;
        try {
          cliente = JSON.parse(authHeader);
        } catch {
          return res.status(401).json({ error: 'Header de autorización inválido' });
        }

        if (!cliente?.email) {
          return res.status(401).json({ error: 'Email de cliente requerido' });
        }

        const devicesCollection = db.collection('blocking_devices');
        const devices = await devicesCollection.find({ email: cliente.email }).toArray();

        const paymentsCollection = db.collection('blocking_payments');
        const historyCollection = db.collection('blocking_history');

        const devicesWithData = await Promise.all(
          devices.map(async (device) => {
            const deviceIdStr = device._id?.toString() || device.id;
            const [payments, history] = await Promise.all([
              paymentsCollection.find({ deviceId: deviceIdStr }).toArray(),
              historyCollection.find({ deviceId: deviceIdStr }).sort({ timestamp: -1 }).limit(10).toArray(),
            ]);
            return {
              ...device,
              id: deviceIdStr,
              payments,
              history,
            };
          })
        );

        return res.json(devicesWithData);
      } catch (error) {
        return res.status(500).json({ error: 'Error fetching devices' });
      }
    }
  }

  return res.status(404).json({ error: 'Endpoint not found' });
}
