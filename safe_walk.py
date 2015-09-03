import simplejson as json
import os
import psycopg2
from psycopg2.extras import RealDictCursor
from flask import Flask, request
from flask.ext.cors import CORS

app = Flask(__name__)
CORS(app)

@app.route('/score', methods=['POST'])
def score():
    conn = psycopg2.connect(host='postgres1.ceipocejvkue.us-west-2.rds.amazonaws.com', database='blacksburg', user='blacksburg_read', password='nrv', cursor_factory=RealDictCursor)
    cur = conn.cursor()
    coordinates = json.loads(request.get_data())
    query = "SELECT * FROM google_route_processing('" + json.dumps(coordinates) + "') WHERE gid IS NOT NULL;"
    roads = []
    road_ids = []
    scores = {'day': [], 'night': []}
    scoring = {"red": 1, "yellow": 2, "green": 3}
    cur.execute(query)
    results = cur.fetchall()
    for road in results:
        if road['gid'] not in road_ids:
            scores['day'].append(scoring[road['day_score']])
            scores['night'].append(scoring[road['night_score']])
            roads.append(road)
            road_ids.append(road['gid'])
    return json.dumps({'scores': {'day': sum(scores['day'])/float(len(scores['day'])), 'night': sum(scores['night'])/float(len(scores['night']))}, 'roads': roads})

if __name__ == '__main__':
    app.run(debug=True)