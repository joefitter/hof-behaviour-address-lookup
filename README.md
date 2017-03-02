# hof-behaviour-address-lookup

A HOF Behaviour for controlling a multi-step address lookup.

## Usage

```js
// steps.js

const AddressLookup = require('hof-behaviour-address-lookup');

module.exports = {
  '/step-1' {
    behaviours: AddressLookup({
      addressKey: 'address-field'
    })
  }
}
```

## Options

* `addressKey` - REQUIRED - the key used to store the formatted address after lookup
* apiSettings - settings to pass to the Model on init. Default MOJ lookup api expects `hostname`, `authorization`, `paths.lookup` and `paths.validate`
* `Model` - a custom Model which exposes a `fetch` method (and `validate` if using api validation). Both `fetch` and `validate` are expected to return a `Promise`
* `validate` - a map of validators to pass to the Model's validate method. The default implementation supports `allowedCountries` which is an Array of accepted countries. - for only English addresses use:

```js
AddressLookup({
  addressKey: 'address',
  validate: {
    allowedCountries: ['England']
  }
});
```

## Custom Model Integration

If you provide a custom model, you should provide a `fetch` method which returns a `Promise` and `resolves` with the data on a successful lookup, and rejects with an `Error` if the service is unavailable. In the case of the service being unavailable a message is shown and a textarea is shown for the address to be input manually.

When providing a custom `validate` function, this should also return a `Promise` which resolves on a success validation, and rejects with an error  with status `418` if validation fails.

## Locales

The following keys are expected to be defined in your translations file.

* `pages.address-lookup.edit` - text to change the postcode once entered. Defaults to `'Change'`;
* `pages.address-lookup.cantfind` - link text for manual entry if you cant find your address in the lookup. Defaults to `'I can\'t find the address in the list'`
* `fields.{key}-postcode.label` - Label for the postcode field when shown on the lookup and manual steps. Defaults to `'Postcode'`
* `pages.address-lookup.postcode-api.not-found` - Message to show if postcode not found. Defaults to `'Sorry – we couldn’t find any addresses for that postcode, enter your address manually'`
* `pages.address-lookup.postcode-api.cant-connect` - Message to show if unable to connect to the lookup service. Defaults to `'Sorry – we couldn’t connect to the postcode lookup service at this time, enter your address manually'`
