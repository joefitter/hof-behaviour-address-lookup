/* eslint max-len: 0 */

'use strict';

module.exports = {
  CANT_FIND: 'I can\'t find the address in the list',
  CHANGE: 'Change',
  POSTCODE_LABEL: 'Postcode',
  POSTCODE_ERROR: {
    'not-found': 'Sorry – we couldn’t find any addresses for that postcode, enter your address manually',
    'cant-connect': 'Sorry – we couldn’t connect to the postcode lookup service at this time, enter your address manually'
  },
  POSTCODE_API: {
    hostname: 'https://postcodeinfo.service.justice.gov.uk',
    authorization: '',
    paths: {
      lookup: 'addresses',
      validate: 'postcodes'
    }
  }
};
