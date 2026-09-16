const mongoose = require('mongoose')

/**
 * GradientCalc — persists gradient calculation history per user / company.
 * Capped at 200 records per company (oldest trimmed on save).
 */
const gradientCalcSchema = new mongoose.Schema(
  {
    company_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },

    // inputs
    rise:        { type: Number, required: true },  // metres
    run:         { type: Number, required: true },  // metres
    input_mode:  { type: String, default: 'rise_run' },
    use_case:    { type: String, default: 'Custom / General' },
    terrain:     { type: String, default: 'Plain' },

    // computed results
    gradient_pct:  { type: Number, required: true },  // e.g. 3.333
    angle_deg:     { type: Number, required: true },  // e.g. 1.909
    ratio_n:       { type: Number, required: true },  // e.g. 30   (1:N)
    slope_length:  { type: Number, required: true },  // metres (hypotenuse)
    mm_per_metre:  { type: Number, required: true },  // mm fall per metre run

    // optional note
    notes: { type: String, default: '' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
)

gradientCalcSchema.index({ company_id: 1, created_at: -1 })
gradientCalcSchema.index({ created_by: 1, created_at: -1 })

module.exports = mongoose.model('GradientCalc', gradientCalcSchema)
