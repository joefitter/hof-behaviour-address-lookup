'use strict';

const path = require('path');
const querystring = require('querystring');
const _ = require('lodash');

const DefaultModel = require('./default-model');
const defaults = require('./defaults');

const getFields = key => ({
  [`${key}-postcode`]: {
    mixin: 'input-text-code',
    validate: ['required', 'postcode'],
    formatter: 'uppercase'
  },
  [`${key}-select`]: {
    mixin: 'select',
    validate: [function required(val) {
      return val !== '-1';
    }]
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
    throw new Error('addressKey must be provided');
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
        fields: _.pick(this.options.fields, step.fields),
        apiError: null
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
        }));
        return `?${qs}`;
      }
      return step;
    }

    successHandler(req, res, cb) {
      super.successHandler(req, res, cb);
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
      const editLink = req.translate('pages.address-lookup.edit', { default: null }) || defaults.CHANGE;
      const cantFind = req.translate('pages.address-lookup.cantfind', { default: null }) || defaults.CANT_FIND;

      let postcodeApiMessageKey;
      let postcodeError;

      if (!isManual) {
        postcodeApiMessageKey = (req.sessionModel.get(`${addressKey}-postcodeApiMeta`) || {}).messageKey;
      }

      if (postcodeApiMessageKey) {
        const key = `pages.address-lookup.postcode-api.${postcodeApiMessageKey}`;
        postcodeError = req.translate(key, req.translate, { default: null }) ||
          defaults.POSTCODE_ERROR[postcodeApiMessageKey];
      }

      return Object.assign({}, locals, {
        postcodeLabel: req.translate(`fields.${addressKey}-postcode.label`, { default: null }) ||
          defaults.POSTCODE_LABEL,
        route: this.options.route,
        editLink,
        cantFind,
        postcodeError,
        postcode,
        section
      });
    }

    process(req, res, callback) {
      if (req.query.step === 'postcode') {
        const postcode = req.form.values[`${addressKey}-postcode`];
        this.model.set({ postcode });
      }
      super.process(req, res, callback);
    }

    // eslint-disable-next-line consistent-return
    lookupPostcode(req, res, callback) {
      this.model.fetch()
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
      const step = req.query.step;
      if (step === 'postcode') {
        return this.lookupPostcode(req, res, err => {
          if (err) {
            return callback(err);
          }
          return super.saveValues(req, res, callback);
        });
      } else if (step === 'lookup') {
        const addressLines = req.form.values[`${addressKey}-select`].split(', ').join('\n');
        req.sessionModel.set(addressKey, addressLines);
      }
      return super.saveValues(req, res, callback);
    }

    getErrorStep(err, req) {
      return `${super.getErrorStep(err, req)}?${querystring.stringify(req.query)}`;
    }

    // eslint-disable-next-line consistent-return
    validate(req, res, callback) {
      if (req.query.step === 'postcode' && this.model.get('validate')) {
        const key = `${addressKey}-postcode`;
        const postcode = encodeURIComponent(req.form.values[key]);
        this.model.validate(postcode)
          .then(() => {
            return super.validate(req, res, callback);
          })
          .catch(err => {
            if (err.status === 418) {
              err = {
                [key]: new this.ValidationError(key, {
                  key,
                  type: err.type,
                  redirect: undefined
                }, req, res)
              };
            } else if (err.status === 403 || err.status === 404) {
              return super.validate(req, res, callback);
            }
            return callback(err);
          });
      } else {
        return super.validate(req, res, callback);
      }
    }
  };
};
