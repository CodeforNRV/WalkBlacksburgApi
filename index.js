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
            var scoring = {"red": 1, "yellow": 2, "green": 3};
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