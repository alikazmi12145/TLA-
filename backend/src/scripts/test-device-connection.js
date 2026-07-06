// Layer-by-layer connection test for a K40. Runs 4 checks:
//   1. TCP socket handshake on port 4370
//   2. UDP socket reachability
//   3. node-zklib ping (device protocol handshake)
//   4. Full device info fetch (getInfo)
//
// Usage:
//   node src/scripts/test-device-connection.js                       # uses primary device from DB
//   node src/scripts/test-device-connection.js <deviceId>            # test a specific saved device
//   node src/scripts/test-device-connection.js 192.168.100.201 4370  # ad-hoc test (no DB)
require('dotenv').config();
const net = require('net');
const dgram = require('dgram');
const connectDB = require('../config/db');
const Device = require('../models/Device');
const zk = require('../services/zkteco.service');

const [a1, a2] = process.argv.slice(2);

const tcpProbe = (ip, port, timeout = 3000) => new Promise((resolve) => {
  const s = new net.Socket();
  const start = Date.now();
  let done = false;
  const finish = (r) => { if (done) return; done = true; try { s.destroy(); } catch { /* noop */ } resolve(r); };
  s.setTimeout(timeout);
  s.once('connect', () => finish({ ok: true, ms: Date.now() - start }));
  s.once('timeout', () => finish({ ok: false, error: 'timeout' }));
  s.once('error', (e) => finish({ ok: false, error: e.code || e.message }));
  s.connect(port, ip);
});

const udpProbe = (ip, port, timeout = 2000) => new Promise((resolve) => {
  const s = dgram.createSocket('udp4');
  let done = false;
  const finish = (r) => { if (done) return; done = true; try { s.close(); } catch { /* noop */ } resolve(r); };
  const timer = setTimeout(() => finish({ ok: false, error: 'no response (may still be reachable — K40 UDP does not always echo)' }), timeout);
  s.on('message', () => { clearTimeout(timer); finish({ ok: true }); });
  s.on('error', (e) => { clearTimeout(timer); finish({ ok: false, error: e.message }); });
  const hello = Buffer.from([0xd0, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  s.send(hello, port, ip, (err) => { if (err) { clearTimeout(timer); finish({ ok: false, error: err.message }); } });
});

(async () => {
  let device;

  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(a1 || '');
  if (isIp) {
    device = { name: 'ad-hoc', ip: a1, port: Number(a2) || 4370, inport: 5200, connectionType: 'TCP' };
    console.log(`\nTesting ad-hoc device ${device.ip}:${device.port}\n`);
  } else {
    await connectDB();
    if (a1) device = await Device.findById(a1);
    else device = await Device.findOne({ isPrimary: true }) || await Device.findOne({ enabled: true });
    if (!device) { console.error('No device found. Configure one in HRMS or pass an IP.'); process.exit(1); }
    console.log(`\nTesting device "${device.name}" @ ${device.ip}:${device.port} (${device.connectionType || 'TCP'})\n`);
  }

  console.log(`--- 1. TCP connect ${device.ip}:${device.port} ---`);
  const tcp = await tcpProbe(device.ip, device.port);
  if (tcp.ok) console.log(`  ✅ open in ${tcp.ms}ms`);
  else console.log(`  ❌ ${tcp.error}`);

  console.log(`\n--- 2. UDP send probe to ${device.ip}:${device.port} ---`);
  const udp = await udpProbe(device.ip, device.port);
  if (udp.ok) console.log('  ✅ device responded on UDP');
  else console.log(`  ⚠ ${udp.error}`);

  console.log(`\n--- 3. node-zklib protocol ping ---`);
  try {
    const p = await zk.ping(device);
    if (p.ok) console.log(`  ✅ protocol handshake ok (${p.latencyMs}ms)`);
    else console.log(`  ❌ ${p.error || 'unknown error'}`);
  } catch (e) {
    console.log(`  ❌ threw: ${e.message}`);
  }

  console.log(`\n--- 4. Fetch device info ---`);
  try {
    const info = await zk.getInfo(device);
    console.log('  ✅ getInfo ok');
    console.log(`     userCount   : ${info.userCount}`);
    console.log(`     fingerCount : ${info.fingerCount}`);
    console.log(`     recordCount : ${info.recordCount}`);
    console.log(`     firmware    : ${info.firmware || '(unknown)'}`);
    console.log(`     serial      : ${info.serialNumber || info.serial || '(unknown)'}`);
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
  }

  console.log('\n--- Verdict ---');
  if (!tcp.ok) {
    console.log('❌ TCP is closed. This is a NETWORK problem, not an HRMS problem.');
    console.log('   Fix in this order:');
    console.log('   1. Confirm the K40\'s Ethernet cable is plugged into the SAME router that gives your PC Wi-Fi.');
    console.log('   2. On the K40: Menu → Info → Comm → IP should read exactly ' + device.ip);
    console.log('   3. From your PC:  ping ' + device.ip);
    console.log('   4. If ping works but TCP fails, disable Windows Firewall temporarily and retest.');
    console.log('   5. If ping fails: router may have AP Isolation on the Wi-Fi SSID — turn it off.');
  } else {
    console.log('✅ Network is fine.');
    console.log('   If the HRMS UI still shows OFFLINE:');
    console.log('   - Restart the backend so the ZKTeco socket handle refreshes.');
    console.log('   - HRMS → Devices → your device → click Test / Connect.');
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
