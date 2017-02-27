'use strict';

const reqres = require('reqres');
const Model = require('hof-model');
const chai = require('chai');

global.expect = chai.expect;
global.sinon = require('sinon');

chai.use(require('sinon-chai'));

global.request = (obj) => {
  return reqres.req(Object.assign({
    translate: sinon.spy((a) => Array.isArray(a) ? a[0] : a),
    sessionModel: new Model()
  }, obj));
};
global.response = reqres.res;
