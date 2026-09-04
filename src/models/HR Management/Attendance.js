const mongoose = require('mongoose');

// Canonical attendance statuses. Kept in one place so controller validation and
// reporting stay consistent.
const ATTENDANCE_STATUSES = ['Present', 'Absent', 'Late', 'Half Day', 'On Leave', 'Holiday', 'Week Off'];

const attendanceSchema = new mongoose.Schema(
  {
    company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company',  required: true },
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },

    // Normalised to midnight (start of day) so one record maps to one calendar day.
    date:        { type: Date, required: true },

    // Human-readable clock strings (e.g. "09:30 AM"). Kept for display + payslips.
    check_in:    { type: String, default: null },
    check_out:   { type: String, default: null },

    // Minutes worked, derived from check_in/check_out on the server. Persisted so
    // reports and payroll never have to recompute from display strings.
    work_minutes: { type: Number, default: 0 },

    status:      { type: String, enum: ATTENDANCE_STATUSES, default: 'Present' },
    notes:       { type: String, default: '' },

    // Who recorded / last edited this row (audit trail).
    marked_by:   { type: String, default: '' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

attendanceSchema.index({ employee_id: 1, date: 1 }, { unique: true });
attendanceSchema.index({ company_id: 1, date: 1 });

const Attendance = mongoose.model('Attendance', attendanceSchema);
Attendance.STATUSES = ATTENDANCE_STATUSES;

module.exports = Attendance;
