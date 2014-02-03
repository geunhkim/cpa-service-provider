"use strict";

var db = require('../models');

var _ = require('lodash');
var uuid = require('node-uuid');

module.exports = function(app) {
  var logger = app.get('logger');
  var config = app.get('config');

  var secondsToMilliseconds = function(seconds) {
    return seconds * 1000;
  };

  var secondsToDate = function(seconds) {
    return new Date(secondsToMilliseconds(seconds));
  };

  var dateToSeconds = function(date) {
    return Math.floor(date.getTime() / 1000);
  };

  var tagToAtomEntry = function(tag) {

    // TODO: replace dummy values
    var entry = {
      title:         "Tag: " + tag.station + " at " + formatAtomDate(tag.time),
      serviceId:     tag.station,
      serviceName:   tag.station,
      imageUrl:      "http://example.com/image.png",
      canonicalUrl:  "http://example.com/" + tag.station + "/" + dateToSeconds(tag.time),
      uniqueId:      "urn:uuid:" + tag.id,
      dateUpdated:   formatAtomDate(tag.time),
      datePublished: formatAtomDate(tag.time),
      summary:       "Description of tag: " + tag.station + " at " + formatAtomDate(tag.time),
    };

    return entry;
  };

  var pad = function(number) {
    if (number < 10) {
      return '0' + number;
    }

    return number;
  };

  /**
   * Returns a date string, with the format <code>YYYY-MM-DDThh:mm:ssZ</code>.
   *
   * Note: We don't use date.toISOString() as that includes the milliseconds
   * part.
   */

  var formatAtomDate = function(date) {
    return date.getUTCFullYear() +
           '-' + pad(date.getUTCMonth() + 1) +
           '-' + pad(date.getUTCDate()) +
           'T' + pad(date.getUTCHours()) +
           ':' + pad(date.getUTCMinutes()) +
           ':' + pad(date.getUTCSeconds()) +
           'Z';
  };

  var createAtomFeed = function(res, clientId, tags) {

    // TODO: replace dummy values
    var data = {
      tagsUrl:     "http://example.com/clients/" + clientId + "/tags",
      authorName:  config.service_provider_name,
      // TODO: replace this with a better unique id value
      uniqueId:    "urn:radiotag:client:" + clientId
    };

    var date = null;

    if (_.isArray(tags)) {
      data.entries = tags.map(tagToAtomEntry);

      if (tags.length > 0) {
        date = tags[0].time;
      }
      else {
        date = new Date();
      }
    }
    else {
      data.entries = [];
      data.entries.push(tagToAtomEntry(tags));

      date = tags.time;
    }

    data.dateUpdated = formatAtomDate(date);

    res.set('Content-Type', 'application/atom+xml; charset=utf-8');
    res.render('tags.ejs', data);
  };

  var protectedResourceHandler =
    require('../lib/protected-resource-handler')(config, db, logger);

  app.get('/tags', protectedResourceHandler, function(req, res) {
    if (req.device.user_id) {
      // Get all the tags from this user's devices.

      db.Client.findAll({ where: { user_id: req.device.user_id } })
        .then(function(clients) {
          var client_ids = _.map(clients, function(client) {
            return client.id;
          });

          // TODO: do this in a single query?
          return db.Tag.findAll({ where: { client_id: client_ids }, order: 'time DESC' });
        })
        .then(function(tags) {
          createAtomFeed(res, req.device.id, tags);
        },
        function(error) {
          logger.error(error);
          res.send(500);
        });
    }
    else {
      db.Tag
        .findAll({ where: { client_id: req.device.id }, order: 'time DESC' })
        .then(function(tags) {
          createAtomFeed(res, req.device.id, tags);
        },
        function(error) {
          logger.error(error);
          res.send(500);
        });
    }
  });

  /*
   * Parameters:
   * - station: radio station identifier
   * - time: timestamp of tag (seconds since the Unix epoch)
   */

  app.post('/tag', protectedResourceHandler, function(req, res) {
    if (!req.body.station) {
      res.json(400, { error: 'missing/invalid station parameter' });
      return;
    }

    if (!req.body.time || !req.body.time.toString().match(/^\d+$/)) {
      res.json(400, { error: 'missing time parameter' });
      return;
    }

    var time;

    try {
      time = secondsToDate(req.body.time);
    }
    catch (e) {
      res.json(400, { error: 'invalid time parameter' });
      return;
    }

    db.Tag
      .create({
        id:        uuid.v4(),
        station:   req.body.station,
        time:      time,
        client_id: req.device.id
      })
      .complete(function(err, tag) {
        if (err) {
          logger.error(err);
          res.send(500);
        }
        else {
          res.statusCode = 201;
          createAtomFeed(res, req.device.id, tag);
        }
      });
  });
};
