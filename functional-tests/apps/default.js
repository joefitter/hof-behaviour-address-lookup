'use strict';

const AddressLookup = require('../../');

module.exports = {
  steps: {
    '/one': {
      behaviours: AddressLookup({
        addressKey: 'address-one',
        apiSettings: {
          authorization: process.env.POSTCODE_AUTH
        },
        validate: {
          allowedCountries: ['England']
        }
      }),
      next: '/two'
    },
    '/two': {}
  }
};
