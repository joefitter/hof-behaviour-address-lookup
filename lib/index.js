'use strict';

const path = require('path');
const querystring = require('querystring');
const fetch = require('node-fetch');
const _ = require('lodash');

const DefaultModel = require('./default-model');
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

module.exports = config => {
  const addressKey = config.addressKey;
  if (!addressKey) {
    throw new Error('addressKey must be provided')
  }

  const Model = config.Model || DefaultModel;
  const apiSettings = config.apiSettings || {};
  const validate = config.validate;

  return superclass => class extends superclass {
    constructor(options) {
      options.fields = getFields(addressKey);
      options.subSteps = getConfig(addressKey);
      super(options);
    }

    configure(req, res, callback) {
      this.model = new Model(Object.assign({}, apiSettings, { validate }));
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
        const nextSubStep = req.sessionModel.get(`${addressKey}-addresses`) ? 'lookup' : 'address';
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
          `${addressKey}-postcode`,
          `${addressKey}-postcodeApiMeta`
        ]);
      } else if (req.query.step === 'lookup') {
        const addresses = req.sessionModel.get(`${addressKey}-addresses`);
        const formattedlist = _.map(_.map(addresses, 'formatted_address'), address => {
          address = address.split('\n').join(', ');
          return {
            value: address,
            label: address
          };
        });

        const count = `${formattedlist.length} address${formattedlist.length > 1 ? 'es' : ''}`;
        // eslint-disable-next-line max-len
        req.form.options.fields[`${addressKey}-select`].options = [{value: '-1', label: count}].concat(formattedlist);
      }
      super.getValues(req, res, callback);
    }

    locals(req, res, callback) {
      const isManual = req.query.step === 'manual';
      const locals = super.locals(req, res, callback);
      const postcode = req.sessionModel.get(`${addressKey}-postcode`);
      const section = this.options.route.replace(/^\//, '');
      const editLink = conditionalTranslate('pages.address-lookup.edit', req.translate) || defaults.CHANGE;
      const cantFind = conditionalTranslate('pages.address-lookup.cantfind', req.translate) || defaults.CANT_FIND;

      let postcodeApiMessageKey;
      let postcodeError;

      if (!isManual) {
        postcodeApiMessageKey = (req.sessionModel.get(`${addressKey}-postcodeApiMeta`) || {}).messageKey;
      }

      if (postcodeApiMessageKey) {
        postcodeError = conditionalTranslate(`pages.address-lookup.postcode-api.${postcodeApiMessageKey}`, req.translate) ||
          defaults.POSTCODE_ERROR[postcodeApiMessageKey];
      }

      return Object.assign({}, locals, {
        postcodeLabel: conditionalTranslate(`fields.${addressKey}-postcode.label`, req.translate) || defaults.POSTCODE_LABEL,
        route: this.options.route,
        editLink,
        cantFind,
        postcodeError,
        postcode,
        section
      });
    }

    // eslint-disable-next-line consistent-return
    process(req, res, callback) {
      if (req.query.step !== 'postcode') {
        return super.process(req, res, callback);
      }
      const postcode = req.form.values[`${addressKey}-postcode`];
      const previousPostcode = req.sessionModel.get(`${addressKey}-postcode`);
      if (!postcode
        || previousPostcode && previousPostcode === postcode) {
        return callback();
      }

      this.model.fetch(postcode)
        .then(data => {
          if (data.length) {
            req.sessionModel.set(`${addressKey}-addresses`, data);
          } else {
            req.sessionModel.unset(`${addressKey}-addresses`);
            req.sessionModel.set(`${addressKey}-postcodeApiMeta`, {
              messageKey: 'not-found'
            });
          }
          return callback();
        })
        .catch(err => {
          if (err.code === 501) {
            req.sessionModel.unset([
              `${addressKey}-postcodeApiMeta`,
              `${addressKey}-addresses`
            ]);
            return callback();
          }
          req.sessionModel.set(`${addressKey}-postcodeApiMeta`, {
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
        const addressLines = req.form.values[`${addressKey}-select`].split(', ').join('\n');
        req.sessionModel.set(addressKey, addressLines);
      }
      super.saveValues(req, res, callback);
    }

    // eslint-disable-next-line consistent-return
    validate(req, res, callback) {
      if (req.query.step === 'postcode' && this.model.validate) {
        const key = `${addressKey}-postcode`;
        const postcode = encodeURIComponent(req.form.values[key]);
        this.model.validate(postcode)
          .then(json => {
            return callback();
          })
          .catch(err => {
            if (err.code === 418) {
              err = {
                [key]: new this.ValidationError(key, {
                  key,
                  type: err.type,
                  redirect: undefined
                }, req, res)
              };
            }
            return callback(err);
          });
      } else {
        return super.validate(req, res, callback);
      }
    }

    // eslint-disable-next-line consistent-return
    validateField(key, req) {
      const field = `${addressKey}-select`;
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
};
