const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Finance Management/expenseController');
const { allow } = require('../../middleware/roleGuard');

// Only these roles can create/edit/delete expenses
const financeRoles = ['Company Owner', 'Manager', 'Accountant'];

router.get   ('/',    ctrl.listExpenses);
router.post  ('/',    allow(...financeRoles), ctrl.createExpense);
router.put   ('/:id', allow(...financeRoles), ctrl.updateExpense);
router.delete('/:id', allow('Company Owner', 'Accountant'), ctrl.deleteExpense);

module.exports = router;
