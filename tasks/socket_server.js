/*
 * Simplified grunt-bbb-server with socket.io support and API support
 *
 * Originally:
 * grunt-bbb-server
 * https://github.com/backbone-boilerplate/grunt-bbb-server
 *
 * Copyright 2013 Tim Branyen
 * Licensed under the MIT license.
 */
"use strict";

module.exports = function(grunt) {
  var ENV = process.env;
  var CWD = process.cwd();
  var baseDir = CWD + "/web/"; // TODO: this should probably be an option.

  var path = require("path");
  var fs = require("fs");
  var https = require("https");
  var http = require("http");

  // External libs.
  var express = require("express");
  var gzip = require("gzip-js");
  var socketio = require("socket.io");

  // Shorthand Lo-Dash.
  var _ = grunt.util._;

  grunt.registerMultiTask("socket-server", "Run web server with socket.io.", function() {

    var options = this.options({
      // Fundamentals.
      favicon: "favicon.ico",
      index: "web/index.html",

      // Should this router automatically handle pushState requests.
      pushState: true,

      // Url root paths.  These are useful to determine where application vs
      // vendor code exists in the path.
      root: "/",

      // Should this server exist forever or die immediately after all tasks
      // are done.
      forever: true,
      force: true,

      // Controls how the server is run.
      ssl: ENV.SSL || false,
      host: ENV.HOST || "127.0.0.1",
      port: ENV.PORT || 8000,

      // Any express-compatible server will work here.
      server: null,

      webInit: null,

      // Register default compiler mappings.
      middleware: {
        // Stylus.
        "\\.styl$": function(buffer, req, res, next) {
          var stylus = require("grunt-lib-stylus").init(grunt);
          var contentType = "text/css";
          var opts = {
            paths: ["." + req.url.split("/").slice(0, -1).join("/") + "/"]
          };

          // Compile the source.
          stylus.compile(String(buffer), opts, function(contents) {
            res.header("Content-type", contentType);
            next(contents);
          });
        },
      },
    });

    // Merge maps together. (maps urls to folders)
    options.map = _.extend({}, fs.readdirSync(baseDir).filter(function(file) {
      return file[0] !== "." && fs.statSync(baseDir + file).isDirectory();
    }).reduce(function(memo, current) {
      memo[current] = baseDir + current;
      return memo;
    }, {}), options.map);

    // enable stack traces
    grunt.option("stack", options.stack);

    // Run forever and disable crashing.
    if (options.forever === true) {
      // Put this task into async mode, and never complete it.
      this.async();

      // Setting force to true, keeps Grunt from crashing while running the
      // server.
      grunt.option("force", options.force);
    }

    // Make this value more meaningful otherwise you can provide your own keys.
    if (_.isBoolean(options.ssl) && options.ssl) {
      // Load the SSL certificates, in case they are needed.
      options.ssl = {
        key: fs.readFileSync(__dirname + "/ssl/server.key", "utf8"),
        cert: fs.readFileSync(__dirname + "/ssl/server.crt", "utf8")
      };
    }

    // Run the server.
    run(options);

  });

  // Actually run the server...
  function run(options) {
    // If the server is already available use it.
    var site = options.server ? options.server() : express();
    var protocol = options.ssl ? "https" : "http";

    // Allow compression to be disabled.
    if (options.gzip !== false) {
      site.use(express.compress());
    }

    // setup bodyparser
    site.use(express.bodyParser());

    // setup favicon
    site.use(express.favicon(options.favicon));

    // Go through each compiler and provide an identical serving experience.
    _.each(options.middleware, function(callback, extension) {
      // Investigate if there is a better way of writing this.
      site.get(new RegExp(extension), function(req, res, next) {
        var url = req.url;

        // If there are query parameters, remove them.
        url = url.split("?")[0];

        // Determine the correct asset path.
        var path = options.map[url.slice(1)] || baseDir + url;

        // Read in the file contents.
        fs.readFile(path, function(err, buffer) {
          // File wasn't found.
          if (err) {
            return next();
          }

          // run the middleware
          callback(buffer, req, res, next);
        });
      });
    });


    // Map static folders to take precedence over redirection.
    Object.keys(options.map).sort().reverse().forEach(function(name) {

      var dirMatch = grunt.file.isDir(options.map[name]) ? "/*" : "";
      site.get(options.root + name + dirMatch, function(req, res, next) {
        // Find filename.

        var filename = req.url.slice((options.root + name).length);
        // If there are query parameters, remove them.
        filename = filename.split("?")[0];
        res.sendfile(path.join(options.map[name] + filename));
      });
    });

    // allow external initialization before starting the web server
    if (_.isFunction(options.webInit)) {
      options.webInit(site, options);
    }

    // Compression middleware.
    site.all("*", function(content, req, res, next) {
      if (content) {
        return res.send(content);
      }

      next();
    });

    // Ensure all routes go to index, since this is a client side app.
    if (options.pushState) {
      site.all("*", function(req, res) {
        fs.createReadStream(options.index).pipe(res);
      });
    }

    // Echo out a message alerting the user that the server is running.
    console.log("Listening on", protocol + "://" + options.host + ":" +
      options.port);

    var io;
    // Start listening.
    if (!options.ssl) {
      var httpServer = http.createServer(site);

      io = socketio.listen(httpServer);
      if (_.isFunction(options.webSocketInit)) {
        options.webSocketInit(io, options);
      }

      return httpServer.listen(options.port, options.host);
    }


    // Create the SSL server instead...
    var httpsServer = https.createServer(options.ssl, site);
    io = socketio.listen(httpsServer);
    if (_.isFunction(options.webSocketInit)) {
      options.webSocketInit(io, options);
    }
    httpsServer.listen(options.port, options.host);
  }
};
