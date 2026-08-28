const express = require('express')
const ctrl = require('../../controllers/Marketplace Management/enquiryController')
const retailerMarketplace = require('../../controllers/Retailer Management/retailerMarketplaceController')
const { requireApprovedSeller } = require('../../middleware/retailerAccess')
const { validateObjectIdParam } = require('../../middleware/validateObjectId')

const router = express.Router()
router.param('id', validateObjectIdParam('id'))

router.get('/stats', ctrl.enquiryStats)
router.get('/', ctrl.listEnquiries)
router.post('/', ctrl.createEnquiry)

// Seller-side retailer marketplace offer and reply endpoints.
router.get('/:id/offers', requireApprovedSeller, retailerMarketplace.sellerListOffers)
router.post('/:id/offers', requireApprovedSeller, retailerMarketplace.sellerCreateOffer)
router.get('/:id/messages', requireApprovedSeller, retailerMarketplace.sellerListMessages)
router.post('/:id/messages', requireApprovedSeller, retailerMarketplace.sellerCreateMessage)

router.get('/:id', ctrl.getEnquiry)
router.patch('/:id', ctrl.updateEnquiry)
router.delete('/:id', ctrl.deleteEnquiry)

module.exports = router
