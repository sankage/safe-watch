function get(url) {
  // Return a new promise.
  return new Promise(function(resolve, reject) {
    // Do the usual XHR stuff
    var req = new XMLHttpRequest();
    req.open('GET', url);

    req.onload = function() {
      // This is called even on 404 etc
      // so check the status
      if (req.status == 200) {
        // Resolve the promise with the response text
        resolve(req.response);
      }
      else {
        // Otherwise reject with the status text
        // which will hopefully be a meaningful error
        reject(Error(req.statusText));
      }
    };

    // Handle network errors
    req.onerror = function() {
      reject(Error("Network Error"));
    };

    // Make the request
    req.send();
  });
}

function getJSON(url) {
  return get(url).then(JSON.parse);
}

var pairwise = function(list) {
  if (list.length < 2) {
    return [];
  }
  var first = list[0],
        rest = list.slice(1),
      pairs = rest.map(function (x) { return [first, x]; });
  return pairs.concat(pairwise(rest));
};

var calculate_distance = function(p1, p2) {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) +
                   Math.pow(p2.y - p1.y, 2) +
                   Math.pow(p2.z - p1.z, 2));
};

var calculate_distances = function(p1, points) {
  return points.map(function(p) {
    return calculate_distance(p1, p.position);
  });
};

var calculate_midpoint = function(p1, p2) {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
    z: (p1.z + p2.z) / 2
  };
};

var AU = 149597870700;

var systems_promise = new Promise(function(resolve, reject) {
  api_endpoint = 'https://esi.evetech.net/latest/universe/systems/';
  getJSON(api_endpoint).then(function(data) {
    return Promise.all(data.map(id => getJSON(`https://esi.evetech.net/latest/universe/systems/${id}`).catch(() => false)));
  }).then(data => {
    var systems = {};
    var names = [];
    for (let i = 0, j = data.length; i < j; i++) { 
      const system = data[i]; 
      if (!system) continue;
      systems[system.name] = system;
      names.push(system.name);
    };
    systems.order = names.sort();
    resolve(systems);
  });
});

systems_promise.then(function(systems) {
  var element = document.getElementById('system_selector');
  var options = ['<option>Please choose system</option>'];
  systems.order.forEach(function(name) {
    options.push("<option value='" + name + "'>" + name + "</option>");
  });
  element.innerHTML = options.join("\n");
  element.addEventListener('change', function() {
    var name = this.value;
    safe_points_for_system(name).then(function(safe_watch) {
      var data = new vis.DataSet();
      var numbers = [];
      var labels = {};
      safe_watch.planets.forEach(function(planet) {
        var point = planet.position;
        point.style = 1;
        var temp = point.y;
        point.y = point.z;
        point.z = temp;
        labels[point.x + '|' + point.y + '|' + point.z] = planet.name;
        data.add(point);
        numbers.push(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z));
      });
      safe_watch.midpoints.forEach(function(midpoint) {
        var point = midpoint.midpoint;
        point.style = 2;
        var temp = point.y;
        point.y = point.z;
        point.z = temp;
        labels[point.x + '|' + point.y + '|' + point.z] = midpoint.name;
        data.add(point);
      });
      var max = Math.max.apply(null, numbers);
      draw(data, max, labels);
      window.location.hash = '#' + name
    });
  });
  name = window.location.hash.substr(1);
  if (name.length) {
    element.value = name;
    var evt = document.createEvent("HTMLEvents");
    evt.initEvent("change", false, true);
    element.dispatchEvent(evt);
  }
});

var safe_points_for_system = function(system_name) {
  return new Promise(function(resolve, reject) {
    systems_promise.then(function(systems) {
      return systems[system_name];
    }).then(function(system) {
      return Promise.all(
        system.planets.map(function(planet) {
          return `https://esi.evetech.net/latest/universe/planets/${planet.planet_id}`;
        }).map(getJSON)
      );
    }).then(function(planets) {
      planets.push({
        position: { x: 0, y: 0, z: 0 },
        name: 'Sun'
      });
      var pairs = pairwise(planets);
      var midpoints = pairs.map(function(pair) {
        return {
          name: pair[0].name + ' to ' + pair[1].name,
          midpoint: calculate_midpoint(pair[0].position, pair[1].position),
          distance: calculate_distance(pair[0].position, pair[1].position)
        }
      });
      return {
        planets: planets,
        midpoints: midpoints.map(function(mid) {
          return planets.map(function(planet) {
            var midpoint = calculate_midpoint(mid.midpoint, planet.position);
            var distances = calculate_distances(midpoint, planets);
            return {
              name: '(' + mid.name + ') to ' + planet.name,
              midpoint: midpoint,
              distances: distances,
              safe: distances.every(function(d) { return d > 2147483647000 })
            }
          });
        })
      };
    }).then(function(data) {
      final_midpoints = Array.prototype.concat.apply([], data.midpoints);
      data.midpoints = final_midpoints.filter(function(m) {
        return m.safe;
      });
      resolve(data);
    });
  });
};

var draw, graph;

draw = function(data, max, labels) {
  var options = {
    width: '100%',
    height: '100%',
    style: 'dot-color',
    showPerspective: false,
    showGrid: true,
    keepAspectRatio: false,
    verticalRatio: 1.0,
    tooltip: function(point) {
      return labels[point.x + '|' + point.y + '|' + point.z];
    },
    dotSizeRatio: 0.005,
    xValueLabel: function(x) { return Math.round(x / AU) + ' AU'; },
    yValueLabel: function(y) { return Math.round(y / AU) + ' AU'; },
    zValueLabel: function(z) { return Math.round(z / AU) + ' AU'; },
    xMin: -max,
    xMax: max,
    xStep: 5 * AU,
    yMin: -max,
    yMax: max,
    yStep: 5 * AU,
    zMin: -max,
    zMax: max,
    zStep: 5 * AU,
    legendLabel: "Blue: sun and planets; Red: safe spots",
    cameraPosition: {
      horizontal: 0,
      vertical: 0.5 * Math.PI,
      distance: 2.2
    }
  };
  vis.Graph3d.prototype._redrawLegend = function(){};
  var container = document.getElementById('system');
  graph = new vis.Graph3d(container, data, options);
};
