const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company',  required: true },
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date:        { type: Date, required: true },
    check_in:    { type: String, default: null },
    check_out:   { type: String, default: null },
    status:      { type: String, default: 'Present' },
    notes:       { type: String, default: '' },
  },
  { timestamps: { createdAt: 'created_at' } }
);

attendanceSchema.index({ employee_id: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
