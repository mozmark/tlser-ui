var aggs;

var config = {
  "errors": {
    "field": "errorCode",
    "must_not": [{"type": "term", "condition": 0}],
    "transform": "errors",
    "aggregate": {
      "type": "terms"
    }
  },
  "days": {
    "chart": "time",
    "field": "timestamp",
    "must": [
    {"type": "range",
      "condition" : {
      "gte": 1426291200,
      "lte": Date.now()/1000
    }}
    ],
    "aggregate": {
      "type": "histogram",
      "options": {
        "interval": 86400
      }
    }
  },
  "domains": {
    "field": "hostname",
    "aggregate": {
      "type": "terms"
    }
  },
  "channels": {
    "field": "channel",
    "aggregate": {
      "type": "terms"
    }
  },
  "products": {
    "field": "product",
    "aggregate": {
      "type": "terms"
    }
  },
  "builds": {
    "field": "build",
    "aggregate": {
      "type": "terms"
    }
  }
}

var queryTemplate = {
  "query": {
    "filtered": {
      "filter": {
        "bool": {
          "must_not": [],
          "must": [],
          "should": []
        }
      }
    }
  },
  "size": 0,
  "aggs": {
  }
};

function ErrorTransformer() {
  this.map = {};
}

ErrorTransformer.prototype.transform = function(data) {
  transformed = [];
  for (idx in data) {
    var item = data[idx];
    obj = {
      "key": MOZ_ERRORS[item.key] ? MOZ_ERRORS[item.key] : item.key,
      "value": item.value,
      "toString": function() {
        return this.key+":"+this.value
      }
    };
    // if there's a mapping, try to store something that will help us reverse
    transformed[transformed.length] = obj;
    if (item.key != obj.key) {
      if (!this.map[obj]) {
        this.map[obj] = item.key
      } else {
        // TODO: work out if this needs a user warning
        console.log("the reverse map has duplicate entries; reverse may break");
      }
    }
  }
  return transformed;
};

ErrorTransformer.prototype.reverse = function(key, value) {
  var obj = {
    "key": key,
    "value": value,
    "toString": function() {
      return this.key+":"+this.value
    }
  };
  var reversed = this.map[obj];
  return reversed ? reversed : key;
}

var transformers ={"errors": new ErrorTransformer()};

var charts = {};

function transferConditions(field, source, dest) {
  if (!source || !dest) {
    // TODO: actually, probably throw?
    return;
  }
  for (index in source) {
    var condition = source[index];
    if (!condition || !condition.type) {
      continue;
    }
    if (condition.type === "term") {
      var terms = {};
      terms[field] = condition.condition;
      dest[dest.length] = {"term": terms};
    }
    if (condition.type === "range") {
      // TODO: Implement ranges
      var range = {};
      var rangeConditions = {};
      if (condition.condition.lte) {
        rangeConditions.lte = condition.condition.lte;
      }
      if (condition.condition.lt) {
        rangeConditions.lt = condition.condition.lt;
      }
      if (condition.condition.gte) {
        rangeConditions.gte = condition.condition.gte;
      }
      if (condition.condition.gt) {
        rangeConditions.gt = condition.condition.gt;
      }
      range[field] = rangeConditions;
      dest[dest.length] = {"range": range};
    }
  }
}

function buildQuery() {
  var query = JSON.parse(JSON.stringify(queryTemplate));
  // Loop over the config items, add "must", "must_not" items
  for (item in config) {
    var section = config[item];
    var field = section["field"];
    var agg = section["aggregate"];
    if (agg) {
      var aggSection = {};
      aggSection[agg.type] = {"field": field};
      if (agg.options) {
        for (option in agg.options) {
          aggSection[agg.type][option] = agg.options[option];
        }
      }
      query.aggs[item] = aggSection;
    }

    // TODO: check this stuff is present and correct
    var boolFilter = query.query.filtered.filter.bool;

    transferConditions(field, section.must, boolFilter.must);
    transferConditions(field, section.must_not, boolFilter.must_not);
  }
  console.log("query is:");
  console.log(JSON.stringify(query));
  return query;
}

function prepData(esData, appendOther) {
  var data = [];
  // turn data into a list of key / val pairs for listing / rendering
  for (idx in esData.buckets) {
    var item = esData.buckets[idx];
    data[data.length] = {"key": item.key, "value": item.doc_count};
  }
  if (appendOther && esData.sum_other_doc_count > 0) {
    data[data.length] = {"key": "other", "value": esData.sum_other_doc_count};
  }
  return data;
}

function TLSERTime(parentElem, data) {
  this.mainDiv = document.createElement("div");
  this.mainDiv.className = "line-section";
  this.canvas = document.createElement("canvas");
  this.canvas.className = "line";
  this.canvas.id = "line-1";
  this.mainDiv.appendChild(this.canvas);
  parentElem.appendChild(this.mainDiv);
  this.updateData(data);
}

TLSERTime.prototype.updateData = function(esData) {
  var data = prepData(esData, false);

  if (this.chart) {
    this.chart.destroy();
    this.chart = null;
  }

  this.showChart(data);
};

TLSERTime.prototype.prepareDataForRender = function(data) {
  var first = null;
  var dataset = {"data":[]};
  var labels = [];

  for (idx in data) {
    var item = data[idx];
    if (!first) {
      first = item.key;
    }

    var date = new Date(item.key * 1000);
    // TODO: fill in the blanks on date - requires some info on scale
    labels[labels.length] = "" +(0 == ((item.key - first) % (86400 * 7)) ?
          date.getFullYear()+"/"+(date.getMonth()+1)+"/"+date.getDate() : "");
    dataset.data[dataset.data.length] = item.value;
  }
  return {
    "labels": labels,
    "datasets": [dataset]
  };
}

TLSERTime.prototype.showChart = function(data) {
  var dataToRender = this.prepareDataForRender(data);

  // display the data
  var options = {
    "bezierCurve" : false,
    "pointDot": false,
    "showTooltips": false
  };

  var ctx = this.canvas.getContext("2d");
  this.chart = new Chart(ctx).Line(dataToRender, options);
};

function TLSERDoughnut(parentElem, field, data, transformer) {
  this.mainDiv = document.createElement("div");
  this.mainDiv.className = "chart-section";
  this.heading = document.createElement("h3");
  this.heading.textContent = field;
  this.mainDiv.appendChild(this.heading);
  this.field = field;
  this.canvas = document.createElement("canvas");
  this.canvas.className = "doughnut";
  this.resultContainer = document.createElement("div");
  this.resultContainer.className = "doughnut-result";
  this.resultTable = document.createElement("table");
  this.canvas.id = "doughnut-"+field;
  this.mainDiv.appendChild(this.canvas);
  var resultHeading = document.createElement("h4");
  resultHeading.textContent = "Top results";
  this.resultContainer.appendChild(resultHeading);
  this.excludeHeading = document.createElement("h4");
  this.excludeHeading.textContent = "Excluded";
  this.excludeTable = document.createElement("table");
  // TODO move the default (display: none) to the CSS
  this.excludeHeading.style.display = "none";
  this.excludeTable.style.display = "none";
  this.resultContainer.appendChild(this.resultTable);
  this.resultContainer.appendChild(this.excludeHeading);
  this.resultContainer.appendChild(this.excludeTable);
  this.mainDiv.appendChild(this.resultContainer);
  parentElem.appendChild(this.mainDiv);
  this.transformer = transformer;
  this.updateData(data);
}

TLSERDoughnut.prototype.showLists = function(data) {
  var appendExcludes = false;

  // clear the div of elements
  var output = this.resultTable;
  while(output.childElementCount > 0){
    output.removeChild(output.childNodes[0]);
  }
  while(this.excludeTable.childElementCount > 0){
    this.excludeTable.removeChild(this.excludeTable.childNodes[0]);
  }

  var configSection = null;
  for (sectionName in config) {
    var section = config[sectionName];
    if (section.field === this.field) {
      configSection = section;
      break;
    }
  }

  if (configSection && configSection.must_not) {
    for (idx in configSection.must_not) {
      var obj = configSection.must_not[idx];
      var excludeRow = document.createElement("tr");
      var excludeActions = document.createElement("td");
      var includeButton = document.createElement("button");
      includeButton.textContent = "include";
      var excludeCb = function(excludeSection) {
        return function(evt) {
          excludeSection.must_not = [];
          submit();
        };
      }(configSection);
      includeButton.addEventListener("click", excludeCb, false);
      excludeActions.appendChild(includeButton);
      var excludeValueCell = document.createElement("td");
      excludeValueCell.textContent = obj.condition;

      excludeRow.appendChild(excludeActions);
      excludeRow.appendChild(excludeValueCell);

      this.excludeTable.appendChild(excludeRow);
      appendExcludes = true;
    }
  }

  if (appendExcludes) {
    this.excludeHeading.style.display = "";
    this.excludeTable.style.display = "";
  } else {
    this.excludeHeading.style.display = "none";
    this.excludeTable.style.display = "none";
  }

  // show the results in the result list
  for (idx in data) {
    var item = data[idx];
    console.log("processing "+item.key);
    var row = document.createElement("tr");
    var filterCell = document.createElement("td");
    filterCell.className = "actions-cell";
    var excludeCell = document.createElement("td");
    excludeCell.className = "actions-cell";
    var keyCell = document.createElement("td");
    var valCell = document.createElement("td");
    // add actions
    var filter = document.createElement("div");
    var filterBox = document.createElement("input");
    filterBox.type = "checkbox";
    filterBox.className = "switch";
    filterBox.id = item.key+"-switch";

    var filterLabel = document.createElement("label");
    /*filterLabel.textContent = "filter";*/
    filterLabel.htmlFor = filterBox.id;
    filterLabel.title = "Filter by this value";

    console.log(" processing "+configSection.field);
    if (configSection.must && configSection.must.length > 0) {
      filterBox.checked = true;
      filterLabel.title = "Remove filter";
    }

    var filterKey = this.transformer ?
        this.transformer.reverse(item.key, item.value) :
        item.key;

    var filterCb = function(field, value) {
      return function(evt) {
        console.log("invoked for "+field+" : "+value);
        for (name in config) {
          var item = config[name];
          if (item.field === field) {
            if (evt.target.checked) {
              // add the entry to the filter
              if (!item.must) {
                item.must = [];
              }
              item.must = [{"type": "term", "condition": value}];
            } else {
              // remove the entry from the filter
              item.must = [];
            }
          }
        }
        submit();
      };
    }(this.field, filterKey);

    var excludeCb = function(excludeSection, value) {
      return function(evt) {
        if (!excludeSection.must_not) {
          excludeSection.must_not = [];
        }
        excludeSection.must_not[excludeSection.must_not.length] = {"type": "term", "condition": value};
        submit();
      };
    }(configSection, filterKey);

    var excludeBtn = document.createElement("button");
    /*excludeBtn.textContent = " ";*/
    excludeBtn.className = "exclude-btn";
    excludeBtn.title = "Exclude this value from results";
    excludeBtn.addEventListener("click", excludeCb, false);
    excludeCell.appendChild(excludeBtn);

    filterBox.addEventListener("change", filterCb, false);

    filter.appendChild(filterBox);
    filter.appendChild(filterLabel);
    filterCell.appendChild(filter);
    keyCell.textContent = item.key;
    valCell.textContent = item.value;
    row.appendChild(filterCell);
    row.appendChild(excludeCell);
    row.appendChild(keyCell);
    row.appendChild(valCell);
    output.appendChild(row);
  }
}

TLSERDoughnut.prototype.showChart = function(data) {
  var dataToRender = this.prepareDataForRender(data);
  // display the data
  var options = {
    "animateRotate": false,
    "animateScale": false
  };

  var ctx = this.canvas.getContext("2d");
  this.chart = new Chart(ctx).Doughnut(dataToRender, options);

  this.canvas.onclick = function(evt) {
    var segments = this.chart.getSegmentsAtEvent(evt);
    for (segment of segments) {
      if (this.transformer) {
        console.log("label should be "+
            this.transformer.reverse(segment.label, segment.value));
      }
    }
  }.bind(this);
};

TLSERDoughnut.prototype.prepareDataForRender = function(startData) {
  var chartData = [];

  for (idx in startData){
    var item = startData[idx];

    chartData[chartData.length] = {
      "value": item.value,
      "color": "#FF0000",
      "highlight": "#0000FF",
      "label": item.key
    };
  }
  return chartData;
};

TLSERDoughnut.prototype.updateData = function(esData) {
  var data = prepData(esData, true);
  if (this.transformer) {
    data = this.transformer.transform(data);
  }

  if (this.chart) {
    this.chart.destroy();
    this.chart = null;
  }

  this.showChart(data);
  this.showLists(data);
};

function reqListener() {
  try {
    var obj = JSON.parse(this.responseText);

    aggs = obj.aggregations;
    var chartsDiv = document.getElementById("charts");

    for (aggName in obj.aggregations) {
      // Find or create a chart for this data
      var chart = charts[aggName];
      if (!chart) {
        // use supplied data transform
        var transformer = null;
        if (config[aggName] && config[aggName].transform){
          transformer = transformers[config[aggName].transform];
        }
        // switch chart type on config (e.g. days should be line)
        if (config[aggName] && config[aggName].chart === "time") {
          chart = new TLSERTime(chartsDiv, obj.aggregations[aggName]);
        } else {
          var fieldName = null;
          var agg = config[aggName];
          if (agg.field) {
            fieldName = agg.field;
          }
          chart = new TLSERDoughnut(chartsDiv, fieldName, obj.aggregations[aggName], transformer);
        }
        charts[aggName] = chart;
      } else {
        chart.updateData(obj.aggregations[aggName]);
      }
    }
  } catch (e) {
    console.log("oh noes! "+e)
  }
}

var output = document.getElementById("output");

var oReq = new XMLHttpRequest();
oReq.onload = reqListener;


let fields = document.getElementById("fields");
let search_value = document.getElementById("search_value");
let search_field = document.getElementById("search_field");
for (name in config) {
  let option = document.createElement("option");
  option.value = name;
  fields.appendChild(option);
}

function submit() {
  console.log("ES_BASE is "+ES_BASE);
  oReq.open("POST", ES_BASE+"/_search?", true);
  oReq.send(JSON.stringify(buildQuery()));
}

function search() {
  let field = search_field.value;
  if (config[field]) {
    config[field].must = [{"type": "term", "condition": search_value.value}];
  }
  submit();
}

document.getElementById("btn").addEventListener("click", submit, true);
document.getElementById("search_btn").addEventListener("click", search, true);
document.getElementById("search_form").addEventListener("submit", search, false);

// get aggregates for all by default
submit();
