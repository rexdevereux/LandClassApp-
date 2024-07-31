// Define a dictionary for legend and visualization
var dict = {
  "names": [
    "Water",
    "Trees",
    "Flooded Vegetation",
    "Crops",
    "Built Area",
    "Bare Ground",
    "Snow/Ice",
    "Clouds",
    "Rangeland"
  ],
  "colors": [
    "#419bdf", // Water
    "#397d49", // Trees
    "#7a87c6", // Flooded Vegetation
    "#e49635", // Crops
    "#c4281b", // Built Area
    "#a59b8f", // Bare Ground
    "#a8ebff", // Snow/Ice
    "#FFFFFF", // Clouds
    "#e3e2c3"  // Rangeland
  ],
  "codes": [1, 2, 3, 4, 5, 6, 7, 8, 9] // Corresponding land cover class codes
};

// Import the ImageCollection
var lulc = ee.ImageCollection("projects/sat-io/open-datasets/landcover/ESRI_Global-LULC_10m_TS");

// Load level 1 administrative boundaries (states/provinces)
var level1 = ee.FeatureCollection("FAO/GAUL/2015/level1");

// Create dropdown menu for selecting country (ADM0_NAME)
var countries = level1.aggregate_array('ADM0_NAME').distinct().sort().getInfo();
var countrySelect = ui.Select({
  items: countries,
  placeholder: 'Select a country',
  onChange: updateStates
});

// Create dropdown menu for selecting state/province (ADM1_NAME)
var stateSelect = ui.Select({
  placeholder: 'Select a state/province',
  disabled: true
});

// Create dropdown menu for selecting year
var years = ['2017', '2018', '2019', '2020', '2021', '2022'];
var yearSelect = ui.Select({
  items: years,
  placeholder: 'Select a year',
  disabled: true
});

// Create a panel to hold the country, state, and year selectors
var controlPanel = ui.Panel({
  widgets: [
    ui.Label('Country'),
    countrySelect,
    ui.Label('State/Province'),
    stateSelect,
    ui.Label('Year'),
    yearSelect
  ],
  style: {position: 'top-left', padding: '8px'}
});
Map.add(controlPanel);

// Create a panel to hold the histogram and pie chart
var chartPanel = ui.Panel({
  style: {position: 'bottom-right', padding: '8px'}
});
Map.add(chartPanel);

// Update the state dropdown based on selected country
function updateStates(selectedCountry) {
  var states = level1.filter(ee.Filter.eq('ADM0_NAME', selectedCountry))
                     .aggregate_array('ADM1_NAME').distinct().sort().getInfo();
  stateSelect.items().reset(states);
  stateSelect.setDisabled(false);
  stateSelect.setValue(null, true);
  stateSelect.onChange(function(selectedState) {
    yearSelect.setDisabled(false);
    yearSelect.onChange(function(selectedYear) {
      runAnalysis(selectedCountry, selectedState, selectedYear);
    });
  });
}

// Function to run the analysis with selected country, state, and year
function runAnalysis(country, state, year) {
  // Filter the boundaries 
  var Jurisdiction = level1.filter(ee.Filter.eq('ADM0_NAME', country))
                           .filter(ee.Filter.eq('ADM1_NAME', state));

  // Filter the ImageCollection based on the selected year
  var yearCollection = lulc.filter(ee.Filter.calendarRange(parseInt(year), parseInt(year), 'year'));

  // Mosaic the ImageCollection into a single Image
  var mosaic = yearCollection.mosaic();

  // Define a function to remap the land cover classes
  function remapper(image) {
    var remapped = image.remap([1, 2, 4, 5, 7, 8, 9, 10, 11], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    return remapped;
  }

  // Clip the mosaic to the Jurisdiction borders
  var clipped = mosaic.clip(Jurisdiction);

  // Remap the land cover values in the clipped image
  var remappedClipped = remapper(clipped);

  // Clear previous layers
  Map.layers().reset();

  // Define the visualization parameters
  var visParams = {
    min: 1,
    max: 9,
    palette: dict['colors']
  };

  // Add the clipped, remapped image to the map
  Map.addLayer(remappedClipped, visParams, 'Clipped LULC Image');

  // Paint the Jurisdiction borders onto an empty image
  var JurisdictionBorders = ee.Image().byte().paint({
    featureCollection: Jurisdiction,
    color: 1,
    width: 1
  });

  // Visualization parameters for the Jurisdiction borders
  var JurisdictionBorderVisParams = {
    palette: '#000000' // Black color for the borders
  };

  // Add the Jurisdiction borders to the map
  Map.addLayer(JurisdictionBorders, JurisdictionBorderVisParams, 'Jurisdiction Border');

  // Focus the map view on the selected Jurisdiction
  Map.centerObject(Jurisdiction);

  // Calculate the pixel counts for each land cover type
  var counts = dict.codes.map(function(code, idx) {
    var count = remappedClipped.eq(code).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: Jurisdiction.geometry(),
      scale: 30,
      maxPixels: 1e13
    }).get('remapped');
    return ee.Feature(null, {landcover_type: dict.names[idx], count: ee.Number(count).divide(100)});
  });

  // Display the pixel counts in hectares in the chart panel
  ee.FeatureCollection(counts).evaluate(function(result) {
    chartPanel.clear();
    chartPanel.add(ui.Label('Area (hectares):'));
    var data = [['Land Cover Type', 'Area (hectares)']];
    result.features.forEach(function(feature) {
      chartPanel.add(ui.Label(feature.properties.landcover_type + ': ' + feature.properties.count));
      data.push([feature.properties.landcover_type, feature.properties.count]);
    });

    // Create and add the pie chart with matching colors
    var pieChart = ui.Chart(data).setChartType('PieChart').setOptions({
      title: 'Land Cover Area Distribution',
      colors: dict['colors'],
      sliceVisibilityThreshold: 0
    });
    chartPanel.add(pieChart);
  });

  // Convert counts to a feature collection for export
  var featureCollection = ee.FeatureCollection(counts);

  // Export the feature collection as a CSV
  Export.table.toDrive({
    collection: featureCollection,
    description: 'LandCover_Histogram',
    fileFormat: 'CSV'
  });

  // Export the clipped and remapped image
  Export.image.toDrive({
    image: remappedClipped,
    description: 'Clipped_Land_Cover_Map',
    scale: 30,
    region: Jurisdiction.geometry(),
    fileFormat: 'GeoTIFF',
    maxPixels: 1e13
  });
}

// Create a panel to hold the legend widget
var legend = ui.Panel({
  style: {
    position: 'bottom-left', // Move the legend to the bottom-left corner
    padding: '8px 15px'
  }
});

// Function to generate the legend
function addCategoricalLegend(panel, dict, title) {
  var legendTitle = ui.Label({
    value: title,
    style: {
      fontWeight: 'bold',
      fontSize: '18px',
      margin: '0 0 4px 0',
      padding: '0'
    }
  });
  panel.add(legendTitle);

  var makeRow = function(color, name) {
    var colorBox = ui.Label({
      style: {
        backgroundColor: color,
        padding: '8px',
        margin: '0 0 4px 0'
      }
    });

    var description = ui.Label({
      value: name,
      style: {margin: '0 0 4px 6px'}
    });

    return ui.Panel({
      widgets: [colorBox, description],
      layout: ui.Panel.Layout.Flow('horizontal')
    });
  };

  // Get the list of palette colors and class names from the dictionary
  var palette = dict['colors'];
  var names = dict['names'];
  
  for (var i = 0; i < names.length; i++) {
    panel.add(makeRow(palette[i], names[i]));
  }
  
  Map.add(panel);
}

// Add the legend to the map
addCategoricalLegend(legend, dict, 'Land Cover');
