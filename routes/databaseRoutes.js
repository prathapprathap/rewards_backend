const express = require('express');
const router = express.Router();
const databaseController = require('../controllers/databaseController');

router.get('/tables', databaseController.getTables);
router.get('/tables/:tableName', databaseController.getTableStructure);
router.get('/tables/:tableName/data', databaseController.getTableData);
router.post('/tables/:tableName', databaseController.createRecord);
router.put('/tables/:tableName/:id', databaseController.updateRecord);
router.delete('/tables/:tableName/:id', databaseController.deleteRecord);

module.exports = router;
