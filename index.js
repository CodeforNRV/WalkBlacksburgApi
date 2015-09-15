//Lets require/import the HTTP module
var http = require('http');
var dispatcher = require('httpdispatcher');
var pg = require('pg');

//Create the connection to the db
var conString = "postgres://blacksburg_read:nrv@postgres1.ceipocejvkue.us-west-2.rds.amazonaws.com/blacksburg";

//Lets define a port we want to listen to
const PORT=(process.env.PORT || 5000);

//We need a function which handles requests and send response
function handleRequest(request, response){
    try {
        //log the request on console
        //console.log(request.url);
        //Disptach
        dispatcher.dispatch(request, response);
    } catch(err) {
        console.log(err);
    }
}

//Create a server
var server = http.createServer(handleRequest);

//Lets start our server
server.listen(PORT, function(){
    //Callback triggered when server is successfully listening. Hurray!
    console.log("Server listening");
});


//For all your static (js/css/images/etc.) set the directory name (relative path).
dispatcher.setStatic('resources');

//A GET request
dispatcher.onGet("/inBlacksburg", function(req, res) {
    var lat = req.params.lat;
    var lon = req.params.lon;
    // get a pg client from the connection pool
    pg.connect(conString, function(err, client, done) {
        var handleError = function(err) {
            // no error occurred, continue with the request
            if(!err) return false;
            // An error occurred, remove the client from the connection pool.
            // A truthy value passed to done will remove the connection from the pool
            // instead of simply returning it to be reused.
            // In this case, if we have successfully received a client (truthy)
            // then it will be removed from the pool.
            if(client){
                done(client);
            }
            console.log(err);
            res.writeHead(500, {'content-type': 'application/json','Access-Control-Allow-Origin' : '*'});
            res.end(JSON.stringify({"error":"There was an error querying the database"}));
            return true;
        };
        // handle an error from the connection
        if(handleError(err)) return;
        var sql = "SELECT ST_WITHIN(ST_GeometryFromText('POINT(" + lon + " " + lat + ")', 4326),ST_TRANSFORM(ST_SetSRID(geom, 2284), 4326)) AS in_blacksburg FROM corporate_boundary;";
        client.query(sql, function(err, result) {
            // handle an error from the query
            if(handleError(err)) return;
            // return the client to the connection pool for other requests to reuse
            done();
            res.writeHead(200, {'Content-Type': 'application/json','Access-Control-Allow-Origin' : '*'});
            res.end(JSON.stringify(result.rows[0]));
        });
    });
});

dispatcher.onGet("/crime", function(req, res) {
    var enddate = new Date(); //Default end date is today
    var startdate = new Date();
    startdate.setMonth(startdate.getMonth() - 6) //Default start date 6 months prior to today
    if (typeof req.params.startdate != 'undefined') {
        startdate = new Date(req.params.startdate);
    }
    if (typeof req.params.enddate != 'undefined') {
        enddate = new Date(req.params.enddate);
    }
    // get a pg client from the connection pool
    pg.connect(conString, function(err, client, done) {
        var handleError = function(err) {
            // no error occurred, continue with the request
            if(!err) return false;
            // An error occurred, remove the client from the connection pool.
            // A truthy value passed to done will remove the connection from the pool
            // instead of simply returning it to be reused.
            // In this case, if we have successfully received a client (truthy)
            // then it will be removed from the pool.
            if(client){
                done(client);
            }
            console.log(err);
            res.writeHead(500, {'content-type': 'application/json','Access-Control-Allow-Origin' : '*'});
            res.end(JSON.stringify({"error":"There was an error querying the database"}));
            return true;
        };
        // handle an error from the connection
        if(handleError(err)) return;
        var sql = "SELECT row_to_json(featcoll) FROM " +
            "(SELECT 'FeatureCollection' As type, array_to_json(array_agg(feat)) As features FROM " +
                "(SELECT 'Feature' As type, ST_AsGeoJSON(ST_Transform(ST_Simplify(geom, 2),4326),5)::json As geometry," +
                    "row_to_json((SELECT l FROM (SELECT agencyname, crimecode, datereported, description, location) As l)) As properties " +
                    "FROM crime As tbl WHERE datereported BETWEEN $1 AND $2)" +
                "AS feat)  " +
            "AS featcoll;";
        client.query(sql, [startdate, enddate], function(err, result) {
            // handle an error from the query
            if(handleError(err)) return;
            // return the client to the connection pool for other requests to reuse
            done();
            res.writeHead(200, {'Content-Type': 'application/json','Access-Control-Allow-Origin' : '*'});
            res.end(JSON.stringify(result.rows[0].row_to_json));
        });
    });
});

//A POST request
dispatcher.onPost("/score", function(req, res) {
    var coordinates = req.body;
    // get a pg client from the connection pool
    pg.connect(conString, function(err, client, done) {
        var handleError = function(err) {
            // no error occurred, continue with the request
            if(!err) return false;
            if(client){
                done(client);
            }
            res.writeHead(500, {'content-type': 'application/json','Access-Control-Allow-Origin' : '*'});
            res.end(JSON.stringify({"error":"There was an error querying the database"}));
            return true;
        };
        // handle an error from the connection
        if(handleError(err)) return;
        var sql = "SELECT * FROM google_route_processing('" + coordinates + "');";
        client.query(sql, function(err, result) {
            // handle an error from the query
            if(handleError(err)) return;
            // return the client to the connection pool for other requests to reuse
            done();
            res.writeHead(200, {'Content-Type': 'application/json','Access-Control-Allow-Origin' : '*'});
            if (result.rowCount == 0) {
                res.end(JSON.stringify({"error":"No results"}))
            }
            var scores = {'day': 0, 'night': 0};
            var scoring = {"red": 0.2, "yellow": 1.5, "green": 3};
            var totalLength = 0;
            for (var row in result.rows) {
                var lineLength = result.rows[row]['mylinedistance'];
                scores['day'] += scoring[result.rows[row]['day_score']]*lineLength;
                scores['night'] += scoring[result.rows[row]['night_score']]*lineLength;
                totalLength += lineLength;
            }
            var response = {
                "scores": {
                    "day": scores['day']/totalLength,
                    "night": scores['night']/totalLength
                },
                "roads": result.rows
            };
            res.end(JSON.stringify(response));
        });
    });
});

dispatcher.onPost("/updateCrime", function(req, res) {
    //Get the crime data
    var startdate = req.params.startdate; //eg 08/01/2015
    var enddate = req.params.enddate;
    var pw = req.params.passcode;

    var http = require("http");

    var options = {
        "method": "GET",
        "hostname": "www.crimemapping.com",
        "port": null,
        "path": "/GetIncidents.aspx?db=" + startdate + "&de=" + enddate + "&ccs=AR%2CAS%2CBU%2CDP%2CDR%2CDU%2CFR%2CHO%2CVT%2CRO%2CSX%2CTH%2CVA%2CVB%2CWE&xmin=-8987085.992643457&ymin=4456012.59895246&xmax=-8916763.926621191&ymax=4481504.347885531",
        "headers": {}
    };

    var getreq = http.request(options, function (getres) {
        var chunks = [];
        getres.on("data", function (chunk) {
            chunks.push(chunk);
        });
        getres.on("end", function () {
            var body = Buffer.concat(chunks);
            var data = JSON.parse(body);
            var crimes = data.incidents;
            var sql = "";
            for (var i in crimes) {
                var crime = crimes[i];
                // get a pg client from the connection pool
                sql += "INSERT INTO crime (agencyid, agencyname, casenumber, crimecodeid, crimecode, datereported, description, location, objectid, geom) " +
                    "VALUES ('"+crime["AgencyID"]+"', '"+crime["AgencyName"]+"', '"+crime["CaseNumber"]+"', '"+crime["CrimeCodeID"]+"', '"+crime["CrimeCode"]+"', '" + crime["DateReported"] +
                    "', '"+crime["Description"]+"', '"+crime["Location"]+"', "+crime["ObjectID"]+", ST_GeomFromText('POINT(" + crime["Y"] + " " + crime["X"] + ")',3857));";
            }
            pg.connect("postgres://crimeuser:" + pw + "@postgres1.ceipocejvkue.us-west-2.rds.amazonaws.com/blacksburg", function(err, client, done) {
                var handleError = function(err) {
                    // no error occurred, continue with the request
                    if(!err) return false;
                    if(client){
                        done(client);
                    }
                    res.writeHead(500, {'content-type': 'application/json','Access-Control-Allow-Origin' : '*'});
                    res.end(JSON.stringify({"error":"There was an error inserting into the database","msg":err}));
                    return true;
                };
                // handle an error from the connection
                if(handleError(err)) return;
                client.query(sql, function(err, result) {
                    // handle an error from the query
                    if(handleError(err)) return;
                    console.log('inserted');
                    res.writeHead(200, {'Content-Type': 'application/json','Access-Control-Allow-Origin' : '*'});
                    res.end(JSON.stringify({"inserted_rows":crimes.length}));
                    // return the client to the connection pool for other requests to reuse
                    done();

                });
            });

        });
    });
    getreq.end();

/*
    */
});