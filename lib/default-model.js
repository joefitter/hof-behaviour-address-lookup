'use strict';

const url = require('url');
const _ = require('lodash');
const Model = require('hof-model');
const defaults = require('./defaults');

module.exports = class PostcodesModel extends Model {
  constructor(options) {
    super(options);
    this.options = Object.assign({}, defaults.POSTCODE_API, options);
  }

  fetch(postcode) {
    return new Promise((resolve, reject) => {
      if (_.startsWith(postcode.toUpperCase(), 'BT')) {
        const err = new Error('Postcode not supported');
        err.code = 501;
        return reject(err);
      }
      const attributes = {
        url: `${this.options.hostname}/${this.options.paths.lookup}`,
        query: {
          postcode
        }
      };
      const reqConf = url.parse(this.url(attributes));

      reqConf.method = 'GET';
      reqConf.headers = {
        Authorization: this.options.authorization || ''
      };
      this.request(reqConf, (err, data) => {
        if (err) {
          return reject(err);
        }
        return resolve(data);
      });
    });
  }

  validate(postcode) {
    return new Promise((resolve, reject) => {
      let allowedCountries = this.options.validate && this.options.validate.allowedCountries;
      if (!allowedCountries) {
        return resolve();
      }
      const attributes = {
        url: `${this.options.hostname}/${this.options.paths.validate}/${postcode}`
      };
      const reqConf = url.parse(this.url(attributes));
      reqConf.method = 'GET';
      reqConf.headers = {
        Authorization: this.options.authorization
      };
      this.request(reqConf, (err, data) => {
        if (err) {
          return reject(err);
        }
        if (data && data.country && data.country.name) {
          allowedCountries = _.castArray(allowedCountries).map(c => c.toLowerCase());
          if (allowedCountries.indexOf(data.country.name.toLowerCase()) === -1) {
            const err = new Error('Validation Error');
            err.code = 418;
            err.type = 'country';
            return reject(err);
          }
        }
        return resolve();
      });
    });
  }
};
