require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Department = require('../models/Department');
const Shift = require('../models/Shift');
const Setting = require('../models/Setting');
const Holiday = require('../models/Holiday');
const { ROLES } = require('../config/constants');
const logger = require('../utils/logger');

const run = async () => {
  await connectDB();
  try {
    // Settings
    if (!(await Setting.findOne())) {
      await Setting.create({});
      logger.info('Settings created');
    }

    // Departments
    const deptDefs = [
      { name: 'Operations', code: 'OPS' },
      { name: 'Sales', code: 'SAL' },
      { name: 'Human Resources', code: 'HR' },
      { name: 'Information Technology', code: 'IT' },
    ];
    for (const d of deptDefs) {
      await Department.findOneAndUpdate({ name: d.name }, d, { upsert: true, setDefaultsOnInsert: true });
    }
    const opsDept = await Department.findOne({ name: 'Operations' });

    // Shifts
    const shifts = [
      { name: 'Morning', startTime: '09:00', endTime: '18:00', graceMinutes: 10, type: 'MORNING' },
      { name: 'Evening', startTime: '14:00', endTime: '23:00', graceMinutes: 10, type: 'EVENING' },
      { name: 'Night', startTime: '22:00', endTime: '07:00', graceMinutes: 10, type: 'NIGHT' },
    ];
    for (const s of shifts) {
      await Shift.findOneAndUpdate({ name: s.name }, s, { upsert: true, setDefaultsOnInsert: true });
    }
    const morningShift = await Shift.findOne({ name: 'Morning' });

    // Super Admin
    const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@tlahrms.com').toLowerCase();
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345';
    let admin = await User.findOne({ email: adminEmail });
    if (!admin) {
      admin = await User.create({
        employeeId: 'TLA-0001',
        fullName: process.env.SEED_ADMIN_NAME || 'Super Admin',
        email: adminEmail,
        password: adminPassword,
        role: ROLES.SUPER_ADMIN,
        designation: 'Super Administrator',
        joiningDate: new Date(),
        department: opsDept?._id,
        shift: morningShift?._id,
        basicSalary: 0,
        status: 'ACTIVE',
      });
      // Never log the plaintext password in production — it would end up in
      // PM2 log files / journald and, worse, in any log-shipping pipeline.
      // In dev we still print it once so first-time contributors know the
      // seeded credentials without opening the seeder source.
      if (process.env.NODE_ENV === 'production') {
        logger.info(`Super admin created: ${adminEmail} (password from SEED_ADMIN_PASSWORD env)`);
      } else {
        logger.info(`Super admin created: ${adminEmail} / ${adminPassword}`);
      }
    } else {
      logger.info('Super admin already exists');
    }

    // Sample HR + Employee
    //
    // These fixtures have well-known passwords (Hr@12345 etc.) and exist
    // purely so a fresh dev checkout has non-admin accounts to log in as.
    // Creating them in production would ship publicly-known credentials
    // into a live database — an immediate account takeover. Skip in prod
    // unless the operator explicitly opts in with SEED_DEMO_USERS=true.
    const seedDemoUsers =
      process.env.NODE_ENV !== 'production' ||
      String(process.env.SEED_DEMO_USERS || '').toLowerCase() === 'true';
    const samples = seedDemoUsers ? [
      { employeeId: 'TLA-1001', fullName: 'HR Manager', email: 'hr@tlahrms.com', password: 'Hr@12345', role: ROLES.HR_MANAGER },
      { employeeId: 'TLA-1002', fullName: 'Team Leader One', email: 'lead@tlahrms.com', password: 'Lead@12345', role: ROLES.TEAM_LEADER },
      { employeeId: 'TLA-1003', fullName: 'John Employee', email: 'employee@tlahrms.com', password: 'Emp@12345', role: ROLES.EMPLOYEE, basicSalary: 60000, dailyTarget: 10, commissionRate: 5 },
    ] : [];
    if (!seedDemoUsers) {
      logger.info('Skipping demo user seed (production).  Set SEED_DEMO_USERS=true to override.');
    }
    for (const s of samples) {
      const existing = await User.findOne({ email: s.email });
      if (!existing) {
        await User.create({
          ...s,
          department: opsDept?._id,
          shift: morningShift?._id,
          designation: s.role,
          joiningDate: new Date(),
          status: 'ACTIVE',
        });
        logger.info(`Created ${s.role}: ${s.email}`);
      }
    }

    // Sample holidays for current year
    const year = new Date().getFullYear();
    const holidays = [
      { title: 'New Year', date: new Date(`${year}-01-01`) },
      { title: 'Pakistan Day', date: new Date(`${year}-03-23`) },
      { title: 'Labour Day', date: new Date(`${year}-05-01`) },
      { title: 'Independence Day', date: new Date(`${year}-08-14`) },
    ];
    for (const h of holidays) {
      await Holiday.findOneAndUpdate({ title: h.title, date: h.date }, h, { upsert: true });
    }

    logger.info('Seeding complete');
  } catch (err) {
    logger.error(`Seeder error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
