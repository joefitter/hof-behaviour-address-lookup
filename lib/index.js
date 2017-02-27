'use strict';

const path = require('path');
const querystring = require('querystring');
const fetch = require('node-fetch');
const _ = require('lodash');

const defaults = require('./defaults');

const conditionalTranslate = (key, t) => {
  let result = t(key);
  if (result === key) {
    result = null;
  }
  return result;
};

const getFields = key => ({
  [`${key}-postcode`]: {
    mixin: 'input-text-code',
    validate: ['required', 'postcode'],
    formatter: 'uppercase'
  },
  [`${key}-select`]: {
    mixin: 'select'
  },
  [key]: {
    mixin: 'textarea',
    validate: 'required',
    'ignore-defaults': true,
    formatter: ['trim', 'hyphens'],
    attributes: [{
      attribute: 'rows',
      value: 6
    }]
  }
});

const getConfig = key => ({
  postcode: {
    fields: [`${key}-postcode`]
  },
  lookup: {
    fields: [`${key}-select`],
    template: 'address-lookup'
  },
  address: {
    fields: [key],
    template: 'address'
  },
  manual: {
    fields: [key],
    template: 'address'
  }
});

const getStep = req => req.form.options.subSteps[req.query.step];

module.exports = superclass => class extends superclass {
  constructor(options) {
    options.addressKey = options.addressKey || 'address';
    options.fields = getFields(options.addressKey);
    options.subSteps = getConfig(options.addressKey);
    super(options);
  }

  configure(req, res, callback) {
    req.query.step = req.query.step || 'postcode';
    const step = getStep(req);
    Object.assign(req.form.options, {
      fields: _.pick(this.options.fields, step.fields)
    });
    if (step.template) {
      req.form.options.template = path.resolve(__dirname, `../templates/${step.template}.html`);
    }
    super.configure(req, res, callback);
  }

  getNextStep(req, res, callback) {
    const step = super.getNextStep(req, res, callback);
    if (req.query.step === 'postcode') {
      const nextSubStep = req.sessionModel.get(`${this.options.addressKey}-addresses`) ? 'lookup' : 'address';
      const qs = querystring.stringify(Object.assign({}, req.query, {
        step: nextSubStep
      }))
      return `?${qs}`;
    }
    return step;
  }

  getValues(req, res, callback) {
    if (req.query.step === 'manual') {
      req.sessionModel.unset([
        `${this.options.addressKey}-postcode`,
        `${this.options.addressKey}-postcodeApiMeta`
      ]);
    } else if (req.query.step === 'lookup') {
      const addresses = req.sessionModel.get(`${this.options.addressKey}-addresses`);
      const formattedlist = _.map(_.map(addresses, 'formatted_address'), address => {
        address = address.split('\n').join(', ');
        return {
          value: address,
          label: address
        };
      });

      const count = `${formattedlist.length} address${formattedlist.length > 1 ? 'es' : ''}`;
      // eslint-disable-next-line max-len
      req.form.options.fields[`${this.options.addressKey}-select`].options = [{value: '-1', label: count}].concat(formattedlist);
    }
    super.getValues(req, res, callback);
  }

  locals(req, res, callback) {
    const isManual = req.query.step === 'manual';
    const locals = super.locals(req, res, callback);
    const postcode = req.sessionModel.get(`${this.options.addressKey}-postcode`);
    const section = this.options.route.replace(/^\//, '');
    const editLink = conditionalTranslate('pages.address-lookup.edit', req.translate) || defaults.CHANGE;
    const cantFind = conditionalTranslate('pages.address-lookup.cantfind', req.translate) || defaults.CANT_FIND;

    let postcodeApiMessageKey;
    let postcodeError;

    if (!isManual) {
      postcodeApiMessageKey = (req.sessionModel.get(`${this.options.addressKey}-postcodeApiMeta`) || {}).messageKey;
    }

    if (postcodeApiMessageKey) {
      postcodeError = conditionalTranslate(`pages.address-lookup.postcode-api.${postcodeApiMessageKey}`, req.translate) ||
        defaults.POSTCODE_ERROR[postcodeApiMessageKey];
    }

    return Object.assign({}, locals, {
      postcodeLabel: req.translate(`fields.${this.options.addressKey}-postcode.label`),
      editLink,
      cantFind,
      postcodeError,
      postcode,
      section,
      route: this.options.route
    });
  }

  // eslint-disable-next-line consistent-return
  process(req, res, callback) {
    if (req.query.step !== 'postcode') {
      return super.process(req, res, callback);
    }
    const postcode = req.form.values[`${this.options.addressKey}-postcode`];
    const previousPostcode = req.sessionModel.get(`${this.options.addressKey}-postcode`);
    if (!postcode
      || previousPostcode && previousPostcode === postcode) {
      return callback();
    }

    if (_.startsWith(postcode, 'BT')) {
      req.sessionModel.unset([
        `${this.options.addressKey}-postcodeApiMeta`,
        `${this.options.addressKey}-addresses`
      ]);
      return callback();
    }

    fetch(`${this.options.config.hostname}${this.options.config.addresses.path}?postcode=${encodeURIComponent(postcode)}`, {
      headers: {
        Authorization: this.options.config.authorization || ''
      }
    })
      .then(response => {
        if (response.status === 200) {
          return response.json();
        } else {
          throw new Error('Error: postcode lookup failed');
        }
      })
      .then(json => {
        if (json.length) {
          req.sessionModel.set(`${this.options.addressKey}-addresses`, json);
        } else {
          req.sessionModel.unset(`${this.options.addressKey}-addresses`);
          req.sessionModel.set(`${this.options.addressKey}-postcodeApiMeta`, {
            messageKey: 'not-found'
          });
        }
        return callback();
      })
      .catch(err => {
        req.sessionModel.set(`${this.options.addressKey}-postcodeApiMeta`, {
          messageKey: 'cant-connect'
        });
        // eslint-disable-next-line no-console
        console.error('Postcode lookup error: ',
          `Code: ${err.status}; Detail: ${err.detail}`);
        return callback();
      });
  }

  saveValues(req, res, callback) {
    if (req.query.step === 'lookup') {
      const addressLines = req.form.values[`${this.options.addressKey}-select`].split(', ').join('\n');
      req.sessionModel.set(this.options.addressKey, addressLines);
    }
    super.saveValues(req, res, callback);
  }

  // eslint-disable-next-line consistent-return
  validate(req, res, callback) {
    if (req.query.step === 'postcode' && this.options.countries) {
      const field = `${this.options.addressKey}-postcode`;
      const postcode = encodeURIComponent(req.form.values[field]);
      fetch(`${this.options.config.hostname}/postcodes/${postcode}`, {
        headers: {
          Authorization: this.options.config.authorization || ''
        }
      })
      .then(response => {
        if (response.status === 200) {
          return response.json();
        }
        return callback();
      })
      .then(json => {
        if (json && json.country && json.country.name) {
          let countries = this.options.countries;
          if (!Array.isArray(this.options.countries)) {
            countries = [countries].map(country => country.toLowerCase());
          }
          if (countries.indexOf(json.country.name.toLowerCase()) === -1) {
            return callback({
              [field]: new this.ValidationError(field, {
                key: `${this.options.addressKey}-postcode`,
                type: 'country',
                redirect: undefined
              }, req, res)
            });
          }
        }
        return callback();
      })
      .catch(err => {
        callback(err);
      });
    } else {
      return super.validate(req, res, callback);
    }
  }

  // eslint-disable-next-line consistent-return
  validateField(key, req) {
    const field = `${this.options.addressKey}-select`;
    if (req.query.step === 'lookup' && req.form.values[key] === '-1') {
      return new this.ValidationError(field, {
        key: field,
        type: 'required',
        redirect: undefined
      });
    }
    return super.validateField(key, req);
  }
};
