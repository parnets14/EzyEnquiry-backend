const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Finance Management/expenseController');

router.get   ('/',    ctrl.listExpenses);
router.post  ('/',    ctrl.createExpense);
router.put   ('/:id', ctrl.updateExpense);
router.delete('/:id', ctrl.deleteExpense);

module.exports = router;
