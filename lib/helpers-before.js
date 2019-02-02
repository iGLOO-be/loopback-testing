/* globals before,describe,after */

var assert = require('assert')
var request = require('supertest')

var _describe = {}
var _before = {}

module.exports = {
  describe: _describe,
  before: _before
}

_before.withApp = function (app) {
  if (app.models.User) {
    // Speed up the password hashing algorithm
    app.models.User.settings.saltWorkFactor = 4
  }

  before(function () {
    this.app = app
    var _request = (this.request = request(app))
    this.post = _request.post
    this.get = _request.get
    this.put = _request.put
    this.del = _request.del
  })
}

_before.cleanDatasource = function (dsName, models) {
  before(function (done) {
    if (!dsName) dsName = 'db'

    if (
      typeof this.app === 'function' &&
      typeof this.app.datasources === 'object' &&
      typeof this.app.datasources[dsName] === 'object'
    ) {
      this.app.datasources[dsName].automigrate(models, done)
      this.app.datasources[dsName].connector.ids = {}
    } else {
      done()
    }
  })
}

_before.givenModel = function (modelName, attrs, optionalHandler) {
  var modelInstance

  if (typeof attrs === 'function') {
    optionalHandler = attrs
    attrs = undefined
  }

  attrs = attrs || {}

  before(function (done) {
    if (modelName === '__USERMODEL__') {
      modelName = this.userModel ? this.userModel : 'User'
    }

    var test = this
    var app = this.app
    var model = app.models[modelName]
    assert(model, 'cannot get model of name ' + modelName + ' from app.models')
    assert(
      model.dataSource,
      'cannot test model ' + modelName + ' without attached dataSource'
    )
    assert(
      typeof model.create === 'function',
      modelName + ' does not have a create method'
    )

    model.create(attrs, function (err, result) {
      if (err) {
        console.error(err.message)
        if (err.details) console.error(err.details)
        done(err)
      } else {
        var modelKey = modelName
        if (typeof optionalHandler === 'string') {
          modelKey = optionalHandler
        }

        test['__USERMODEL__'] = result
        test[modelKey] = result
        modelInstance = result

        done()
      }
    })
  })

  if (typeof optionalHandler === 'function') {
    before(optionalHandler)
  }

  after(function (done) {
    modelInstance.destroy(done)
  })
}

_before.withUserModel = function (model) {
  before(function (done) {
    this.userModel = model
    done()
  })
}

_before.givenUser = function (attrs, optionalHandler) {
  _before.givenModel('__USERMODEL__', attrs, optionalHandler)
}

_before.givenUserWithRole = function (attrs, role, optionalHandler) {
  var roleInstance, roleMappingInstance

  if (typeof role === 'string') {
    role = {
      name: role
    }
  }
  _before.givenUser(attrs, function (done) {
    var test = this
    test.app.models.Role.findOrCreate(role, function (err, result) {
      if (err) {
        console.error(err.message)
        if (err.details) console.error(err.details)
        return done(err)
      }

      test.userRole = result
      roleInstance = result

      test.app.models.RoleMapping.create(
        {
          principalId: test.__USERMODEL__.id,
          principalType: test.app.models.RoleMapping.USER,
          roleId: result.id
        },
        function (err, result) {
          if (err) {
            console.error(err.message)
            if (err.details) console.error(err.details)
            return done(err)
          }

          test.userRoleMapping = result
          roleMappingInstance = result

          done()
        }
      )
    })
  })

  if (typeof optionalHandler === 'function') {
    before(optionalHandler)
  }

  after(function (done) {
    roleInstance.destroy(function (err) {
      if (err) return done(err)
      roleInstance = undefined

      roleMappingInstance.destroy(function (err) {
        if (err) return done(err)
        roleMappingInstance = undefined
        done()
      })
    })
  })
}

_before.givenLoggedInUser = function (credentials, optionalHandler) {
  _before.givenUser(credentials, function (done) {
    var test = this
    this.app.models[this.userModel].login(credentials, function (err, token) {
      if (err) {
        done(err)
      } else {
        test.loggedInAccessToken = token
        done()
      }
    })
  })

  after(function (done) {
    var test = this
    this.loggedInAccessToken.destroy(function (err) {
      if (err) return done(err)
      test.loggedInAccessToken = undefined
      done()
    })
  })
}

_before.givenLoggedInUserWithRole = function (
  credentials,
  role,
  optionalHandler
) {
  _before.givenUserWithRole(credentials, role, function (done) {
    var test = this
    this.app.models[this.userModel].login(credentials, function (err, token) {
      if (err) {
        done(err)
      } else {
        test.loggedInAccessToken = token
        done()
      }
    })
  })

  after(function (done) {
    var test = this
    this.loggedInAccessToken.destroy(function (err) {
      if (err) return done(err)
      test.loggedInAccessToken = undefined
      done()
    })
  })
}

_before.givenAnUnauthenticatedToken = function (attrs, optionalHandler) {
  _before.givenModel('AccessToken', attrs, optionalHandler)
}

_before.givenAnAnonymousToken = function (attrs, optionalHandler) {
  _before.givenModel('AccessToken', { id: '$anonymous' }, optionalHandler)
}

_describe.whenCalledRemotely = function (verb, url, data, cb) {
  if (cb === undefined) {
    cb = data
    data = null
  }

  var urlStr = url
  if (typeof url === 'function') {
    urlStr = '/<dynamic>'
  } else if (typeof url === 'object' && url.hasOwnProperty('placeHolder')) {
    urlStr = url.placeHolder
  }

  describe(verb.toUpperCase() + ' ' + urlStr, function () {
    before(function (cb) {
      if (typeof url === 'function') {
        this.url = url.call(this)
      } else if (typeof url === 'object' && url.hasOwnProperty('callback')) {
        this.url = url.callback.call(this)
      }
      this.remotely = true
      this.verb = verb.toUpperCase()
      this.url = this.url || url
      var methodForVerb = verb.toLowerCase()
      if (methodForVerb === 'delete') methodForVerb = 'del'

      if (this.request === undefined) {
        throw new Error(
          'App is not specified. Please use lt.before.withApp to specify the app.'
        )
      }

      this.http = this.request[methodForVerb](this.url)
      delete this.url
      this.http.set('Accept', 'application/json')
      if (this.loggedInAccessToken) {
        this.http.set('authorization', this.loggedInAccessToken.id)
      }
      if (data) {
        var payload = data
        if (typeof data === 'function') payload = data.call(this)
        this.http.send(payload)
      }
      this.req = this.http.req
      var test = this
      this.http.end(function (err) {
        if (err) {
          console.error(err)
        }
        test.req = test.http.req
        test.res = test.http.res
        delete test.url
        cb()
      })
    })

    cb()
  })
}

_describe.whenLoggedInAsUser = function (credentials, cb) {
  describe('when logged in as user', function () {
    _before.givenLoggedInUser(credentials)
    cb()
  })
}

_describe.whenLoggedInAsUserWithRole = function (credentials, role, cb) {
  describe('when logged in as user', function () {
    _before.givenLoggedInUser(credentials, role)
    cb()
  })
}

_describe.whenCalledByUser = function (credentials, verb, url, data, cb) {
  describe('when called by logged in user', function () {
    _before.givenLoggedInUser(credentials)
    _describe.whenCalledRemotely(verb, url, data, cb)
  })
}

_describe.whenCalledByUserWithRole = function (
  credentials,
  role,
  verb,
  url,
  data,
  cb
) {
  describe('when called by logged in user with role ' + role, function () {
    _before.givenLoggedInUserWithRole(credentials, role)
    _describe.whenCalledRemotely(verb, url, data, cb)
  })
}

_describe.whenCalledAnonymously = function (verb, url, data, cb) {
  describe('when called anonymously', function () {
    _before.givenAnAnonymousToken()
    _describe.whenCalledRemotely(verb, url, data, cb)
  })
}

_describe.whenCalledUnauthenticated = function (verb, url, data, cb) {
  describe('when called with unauthenticated token', function () {
    _before.givenAnAnonymousToken()
    _describe.whenCalledRemotely(verb, url, data, cb)
  })
}
