Ext.ns('App');

Ext.apply(Ext.util.Format, {defaultDateFormat: 'd M Y'});

// Allows cross-domain requests for the restful_geof call in onItemTap
Ext.Ajax.useDefaultXhrHeader = false;

/**
 * Custom class for the Search 
 */
App.SearchFormPopupPanel = Ext.extend(Ext.Panel, {
    map: null,
    floating: true,
    modal: true,
    centered: true,
    hideOnMaskTap: true,
    width: Ext.is.Phone ? undefined : 400,
    height: Ext.is.Phone ? undefined : 400,
    scroll: false,
    layout: 'fit',
    fullscreen: Ext.is.Phone ? true : undefined,
    url: 'http://basemap.pozi.com/ws/rest/v3/ws_search_api_wrapper.php',
    errorText: 'Sorry, we had problems communicating with Pozi search. Please try again.',
    errorTitle: 'Communication error',
    maxResults: 6,
    featureClass: "P",
    
    createStore: function(){
        this.store = new Ext.data.JsonStore({
			autoLoad: false, //autoload the data
			root: 'features',
			fields: [{name: "label"	, mapping:"properties.label"},
	 			{name: "gsln"	, mapping:"properties.gsln"},
	 			{name: "idcol"	, mapping:"properties.idcol"},
	 			{name: "idval"	, mapping:"properties.idval"},
	 			{name: "ld"	, mapping:"properties.ld"}
	 		],
			  proxy: new Ext.data.ScriptTagProxy({
				url: this.url,
				timeout: 5000,
				listeners: {
					exception: function(){
						this.hide();
						Ext.Msg.alert(this.errorTitle, this.errorText, Ext.emptyFn);
					},
					scope: this
				},
				reader:{
					root:'features'
				}
			  })
	});
    },
    
    doSearch: function(searchfield, evt){
        var q = searchfield.getValue();
        this.store.load({
            params: {
                query: q,
                lga: '369',
                config: 'basemap'
            }
        });
    },
    
    onItemTap: function(dataView, index, item, event){
        var record = this.store.getAt(index);

        var url_object = "http://basemap.pozi.com/api/v1/basemap/" + record.data.gsln + "/" + record.data.idcol +  "/is/" + encodeURIComponent(record.data.idval);
        if (record.data.lgacol && record.data.lga)
        {
            url_object += "/"+ record.data.lgacol +"/in/" + record.data.lga;
        }

        Ext.Ajax.request({
            method: "GET",
            url: url_object,
            params: {},
            callback: function(options, success, response) {
                var status = response.status;
                if (status >= 200 && status < 403 && response.responseText) {
                    // We then feed the object returned into the highlight layer
                    var geojson_format = new OpenLayers.Format.GeoJSON({
                        'internalProjection': new OpenLayers.Projection("EPSG:900913"),
                        'externalProjection': new OpenLayers.Projection("EPSG:4326")
                    });
                    var geojson = geojson_format.read(response.responseText);

                    // Calculating the overall envelope of all objects returned
                    var envelope = geojson[0].geometry.getBounds();
                    for (var i=1;i<geojson.length;i++)
                    {
                        envelope.extend(geojson[i].geometry.getBounds());
                    }

                    var lonlat = new OpenLayers.LonLat((envelope.left + envelope.right) / 2, (envelope.top + envelope.bottom) / 2);
                    map.setCenter(lonlat, 18);
                    app.searchFormPopupPanel.hide("pop");
                }
            }
        });
    },
    
    initComponent: function(){
        this.createStore();
        this.resultList = new Ext.List({
            scroll: 'vertical',
            cls: 'searchList',
            loadingText: "Searching ...",
            store: this.store,
            itemTpl: '<div>{label}</div>',
            listeners: {
                itemtap: this.onItemTap,
                scope: this
            }
        });
        this.formContainer = new Ext.form.FormPanel({
            scroll: false,
            items: [{
                xtype: 'button',
                cls: 'close-btn',
                ui: 'decline-small',
                text: 'Close',
                handler: function(){
                    this.hide();
                },
                scope: this 
            }, {
                xtype: 'fieldset',
                scroll: false,
                title: 'Search for a place',
                items: [{
                    xtype: 'searchfield',
                    label: 'Search',
                    placeHolder: 'placename',
                    listeners: {
                        action: this.doSearch,
                        scope: this
                    }
                },
                    this.resultList
                ]
            }]
        });
        this.items = [{
            xtype: 'panel',
            layout: 'fit',
            items: [this.formContainer]
        }];
        App.SearchFormPopupPanel.superclass.initComponent.call(this);
    }
});

App.LayerList = Ext.extend(Ext.List, {
    
    map: null,
    
    createStore: function(){
        Ext.regModel('Layer', {
            fields: ['id', 'name', 'visibility', 'zindex']
        });
        var data = [];
        Ext.each(this.map.layers, function(layer){
            if (layer.displayInLayerSwitcher === true) {
                var visibility = layer.isBaseLayer ? (this.map.baseLayer == layer) : layer.getVisibility();
                data.push({
                    id: layer.id,
                    name: layer.name,
                    visibility: visibility,
                    zindex: layer.getZIndex()
                });
            }
        });
        return new Ext.data.Store({
            model: 'Layer',
            sorters: 'zindex',
            data: data
        });
    },
    
    initComponent: function(){
        this.store = this.createStore();
        this.itemTpl = new Ext.XTemplate(
            '<tpl if="visibility == true">', 
                '<img width="20" src="img/check-round-green.png">', 
            '</tpl>', 
            '<tpl if="visibility == false">', 
                '<img width="20" src="img/check-round-grey.png">', 
            '</tpl>', 
            '<span class="gx-layer-item">{name}</span>'
        );
        this.listeners = {
            itemtap: function(dataview, index, item, e){
                var record = dataview.getStore().getAt(index);
                var layer = this.map.getLayersBy("id", record.get("id"))[0];
                if (layer.isBaseLayer) {
                    this.map.setBaseLayer(layer);
                }
                else {
                    layer.setVisibility(!layer.getVisibility());
                }
                record.set("visibility", layer.getVisibility());
            }
        };
        this.map.events.on({
            "changelayer": this.onChangeLayer,
            scope: this
        });
        App.LayerList.superclass.initComponent.call(this);
    },

    findLayerRecord: function(layer){
        var found;
        this.store.each(function(record){
            if (record.get("id") === layer.id) {
                found = record;
            }
        }, this);
        return found;
    },
    
    onChangeLayer: function(evt){
        if (evt.property == "visibility") {
            var record = this.findLayerRecord(evt.layer);
            record.set("visibility", evt.layer.getVisibility());
        }
    }
    
});
Ext.reg('app_layerlist', App.LayerList);



App.CaptureFormPopupPanel = Ext.extend(Ext.Panel, {
	map: null,
	propertyAddressStore: null,
	floating: true,
	modal: true,
	centered: true,
	// Deactivated mask on tap to allow for selection in the drop down list
	hideOnMaskTap: false,
	width: Ext.is.Phone ? undefined : 400,
	height: Ext.is.Phone ? undefined : 400,
	scroll: false,
	layout: 'fit',
	fullscreen: Ext.is.Phone ? true : undefined,
	//    url: '/ws/rest/v3/capture/ws_property_fire_hazard.php',
	errorText: 'Sorry, we had problems communicating with the Pozi server. Please try again.',
	errorTitle: 'Communication error',
        
	initComponent: function(){
		Ext.regModel('DrainagePit', {
			// Potential issue if property numbers are repeated or missing - would be better to use a real PK for the Id field
			idProperty:'id',
			fields: [
				{name: 'id',     type: 'string', mapping: 'row.id'},
//				{name: 'assetid',     type: 'string', mapping: 'row.assetid'},
				{name: 'desc',    type: 'string', mapping: 'row.desc'},
			       {
					name : 'iddesc',
					convert : function(v, rec) {          
						return rec.data.id+' - '+rec.data.desc;
					}
				}
			]
		});

		Ext.regModel('Staff', {
			// Potential issue if property numbers are repeated or missing - would be better to use a real PK for the Id field
			idProperty:'id',
			fields: [
				{name: 'id',     type: 'string', mapping: 'row.id'},
				{name: 'label',     type: 'string', mapping: 'row.label'}
			]
		});
		
		
		Ext.regModel('ReferenceTable', {
			// Potential issue if property numbers are repeated or missing - would be better to use a real PK for the Id field
			idProperty:'id',
			fields: [
				{name: 'id',     type: 'string'},
				{name: 'label',    type: 'string'}
			]
		});

//		Ext.regModel('HazardStatus', {
//			// Potential issue if property numbers are repeated or missing - would be better to use a real PK for the Id field
//			idProperty:'id',
//			fields: [
//				{name: 'id',     type: 'string'},
//				{name: 'label',    type: 'string'}
//			]
//		});

		// Be careful to the refresh timeline of the content - it has to be refreshed each time the form is invoked
		drainagePitStore = new Ext.data.JsonStore({
	//           data : [
	//                { label : '123 High St',  prop_num : '123123'},
	//                { label : '45 Royal Parade', prop_num : '456456'},
	//                { label : 'Long Road', prop_num : '789789'}
	//           ],
			  proxy: new Ext.data.ScriptTagProxy({
				url: '/ws/rest/v3/ws_closest_pits.php',
				timeout: 5000,
				reader:{
					root:'rows',
					totalCount : 'total_rows'
				}
			  }),
			// Max number of records returned
			pageSize: 10,	
			model : 'DrainagePit',
			autoLoad : false,
			autoDestroy : true,
			listeners: {
				load: function(ds,records,o) {
					var cb = Ext.getCmp('drainage_pit');
					var rec = records[0];
					cb.setValue(rec.data.type);
					cb.fireEvent('select',cb,rec);
					},
				scope: this
			}
		});

		staffStore = new Ext.data.JsonStore({
	//           data : [
	//                { label : '123 High St',  prop_num : '123123'},
	//                { label : '45 Royal Parade', prop_num : '456456'},
	//                { label : 'Long Road', prop_num : '789789'}
	//           ],
			  proxy: new Ext.data.ScriptTagProxy({
				url: '/ws/rest/v3/ws_staff_name.php',
				timeout: 5000,
				reader:{
					root:'rows',
					totalCount : 'total_rows'
				},
				extraParams: { config: 'warrnamboolgis'}
			  }),
			// Max number of records returned
			pageSize: 10,	
			model : 'Staff',
			autoLoad : true
		});
				
		equipmentDataStore = new Ext.data.JsonStore({
	           data : [
	                { id : '1',  label : '1 - Depot jetter'},
	                { id : '2', label : '2 - Contractor'},
	                { id : '3', label : '3 - Sweeper'},
	 	        { id : '4', label : '4 - Sweeper & Jetter'},
	 	        { id : '5', label : '5 - Truck'}
	           ],
	           model: 'ReferenceTable'
	        });

		checkAgainDataStore = new Ext.data.JsonStore({
	           data : [
	                { id : '1',  label : '1 month'},
	                { id : '2', label : '2 months'},
	                { id : '6', label : '6 months'},
	                { id : '12',  label : '12 months'},
	                { id : '18', label : '18 months'},
	                { id : '24', label : '24 months'}
	           ],
	           model: 'ReferenceTable'
	        });

		this.formContainer = new Ext.form.FormPanel({
			id:'form_capture',
			scroll: true,
			items: [{
//				xtype: 'fieldset',
//				scroll: true,
//				title: 'Create new event',
//				items: [{
					xtype: 'selectfield',
					label: 'Pit',
					name:'drainage_pit',
					id:'drainage_pit',
					valueField : 'id',
					displayField : 'iddesc',
					store : drainagePitStore,
					// By construction, this field will always be populated - so we technically don't have to mark it as required
					 required: true
		                },
				{
					xtype: 'selectfield',
					label: 'Eqpmt used',
					name:'eqpmt_used',
					id:'eqpmt_used',
					valueField : 'id',
					displayField : 'label',
					store : equipmentDataStore,
					// By construction, this field will always be populated - so we technically don't have to mark it as required
					 required: true
		                },
				{
					xtype: 'numberfield',
					label: 'Time taken (h)',
					name:'time_taken',
					required: true,
					minValue:0
		                },
				{
					xtype: 'selectfield',
					label: 'Officer',
					name:'officer',
					id:'officer',
					valueField : 'id',
					displayField : 'label',
					store : staffStore,
					 required: true
		                },
				{
					xtype: 'numberfield',
					label: 'Number of staff',
					name:'number_staff',
					minValue:0,
					value: 1
		                },
		                {
					xtype: 'numberfield',
					label: 'Depth debris (mm)',
					name:'depth_debris',
					minValue:0
		                },
				{	
					xtype: 'hiddenfield',
					name: 'check_again_date',
					id: 'check_again_date',
					value: ''
				},
				{
					xtype: 'selectfield',
					label: 'Check again in',
					name:'check_again_interval',
					id:'check_again_interval',
					valueField : 'id',
					displayField : 'label',
					store : checkAgainDataStore,
					// By construction, this field will always be populated - so we technically don't have to mark it as required
					 required: true
		                },
				{
					xtype: 'selectfield',
					label: 'Eqpmt to use',
					name:'eqpmt_to_use',
					id:'eqpmt_to_use',
					valueField : 'id',
					displayField : 'label',
					store : equipmentDataStore,
					// By construction, this field will always be populated - so we technically don't have to mark it as required
					 required: true
		                },
				{  
					xtype:'textareafield',
					name:'comments',
					id:'comments',
					label:'Comments',
					value: '',
					maxRows:2
				},
				{  
					xtype:'hiddenfield',
					name:'config',
					value: 'warrnamboolgis'
				}]
//			}]
,
//			listeners : {
//				submit : function(form, result){
//					console.log('success', Ext.toArray(arguments));
//				},
//				exception : function(form, result){
//					console.log('failure', Ext.toArray(arguments));
//				}
//			},
            
			dockedItems: [{
				xtype: 'toolbar',
				dock: 'bottom',
				items: [{
					text: 'Cancel',
					handler: function() {
						// Important: clear the store elements before resetting the form
						while(drainagePitStore.getCount()>0)
						{
							drainagePitStore.removeAt(0);
						}
						Ext.getCmp('form_capture').reset();
						app.captureFormPopupPanel.hide();
					}
				},
				{xtype: 'spacer'},
				{
					text: 'Save',
					ui: 'confirm',
					handler: function() {
						// Calculating the date based on today and the interval
						var checkAgainDate = new Date();
						var interv = parseInt(Ext.getCmp('check_again_interval').getValue());
						checkAgainDate.setMonth(checkAgainDate.getMonth() + interv);	

						var day_num = checkAgainDate.getDate();
						var day = '' + day_num;
						if (day_num<10)
						{
							day = '0'+day_num;
						}
						var month_num = checkAgainDate.getMonth() + 1;
						var month = ''+month_num;
						if (month_num<10)
						{
							month = '0'+month_num;
						}
						var year = checkAgainDate.getFullYear();
						//document.write(month + "/" + day + "/" + year)
	
						// Setting the form date to this new date using the old format expected by the web service
						Ext.getCmp('check_again_date').setValue(year +'-'+ month +'-'+ day+'T13:00:00.000Z');

						// Sending all that to the web service endpoint
						Ext.getCmp('form_capture').submit({
							url: '/ws/rest/v3/ws_create_pit_cleaning_event.php',
							method: 'POST',
							submitEmptyText: false,
							waitMsg: 'Saving ...',
							success: on_capture_success,
							failure: on_capture_failure
						});
					}
				}]
			}]
		});
        
		var on_capture_success = function(form, action){
			// Important: clear the store elements before resetting the form
			while(drainagePitStore.getCount()>0)
			{
				drainagePitStore.removeAt(0);
			}
			Ext.getCmp('form_capture').reset();
			app.captureFormPopupPanel.hide();
			
			// Reload the vector layer - it should contain the new point
			getFeatures();

			// Reload the WMS layer, in case a status/color has changed
			drainage_pit_layer.redraw(true);
		};

		var on_capture_failure = function(form, action){
			alert("Capture failed");
		};
        
		this.items = [{
			xtype: 'panel',
			layout: 'fit',
			items: [this.formContainer]
		}];
		App.CaptureFormPopupPanel.superclass.initComponent.call(this);
	},
	listeners : {
		show:function(){
			if (drainagePitStore)
		    	{
				if (drainagePitStore.getCount() > 0)
				{
					// This should not happen as we empty the store on save and cancel
					alert('store exists and is populated');
					
				}
				else
				{
					// Populate the combo on show
					var latlon = map.getCenter();
					latlon.transform(sm, gg);
					drainagePitStore.load({params:{longitude:latlon.lon,latitude:latlon.lat,config:'warrnamboolgis'}});

				}				
			}
			else
			{
				// Unclear if this is a valid scenario
				alert('store does not exist');
			}

			/*
			*/
		    },
	}

});



App.CapturePitFormPopupPanel = Ext.extend(Ext.Panel, {
	map: null,
	propertyAddressStore: null,
	floating: true,
	modal: true,
	centered: true,
	// Deactivated mask on tap to allow for selection in the drop down list
	hideOnMaskTap: false,
	width: Ext.is.Phone ? undefined : 400,
	height: Ext.is.Phone ? undefined : 200,
	scroll: false,
	layout: 'fit',
	fullscreen: Ext.is.Phone ? true : undefined,
	errorText: 'Sorry, we had problems communicating with the Pozi server. Please try again.',
	errorTitle: 'Communication error',
        
	initComponent: function(){

		Ext.regModel('ReferenceTable', {
			// Potential issue if property numbers are repeated or missing - would be better to use a real PK for the Id field
			idProperty:'id',
			fields: [
				{name: 'id',     type: 'string'},
				{name: 'label',    type: 'string'}
			]
		});

		// Ordered by historic number of occurrences in the pit database
		pitTypeDataStore = new Ext.data.JsonStore({
	           data : [
	                { id : '280', label : '280 - Side Entry Pit'},
	                { id : '284', label : '284 - Junction Pit'},
	                { id : '282', label : '282 - Grate Pit'},
	                { id : '534', label : '534 - Grated Side Entry Pit'},
	                { id : '536', label : '536 - End Wall'},
	                { id : '281', label : '281 - Soakage Pit'},
	                { id : '283', label : '283 - Footpath Pit'},
	                { id : '535', label : '535 - End Entry Pit'},
	                { id : '327',  label : '327 - Litter Trap'}
	           ],
	           model: 'ReferenceTable'
	        });

		this.formContainer = new Ext.form.FormPanel({
			id:'form_pit_capture',
			scroll: true,
			items: [{
				xtype: 'fieldset',
				scroll: true,
				title: 'Create new pit',
				items: [
				{
					xtype: 'selectfield',
					label: 'Pit type',
					name:'pit_type',
					id:'pit_type',
					valueField : 'id',
					displayField : 'label',
					store : pitTypeDataStore,
					 required: true
		                },
				{  
					xtype:'hiddenfield',
					name:'lat', 
					value: map.getCenter().transform(sm,gg).lat
				},
				{  
					xtype:'hiddenfield',
					name:'lon',
					value: map.getCenter().transform(sm,gg).lon
				},
				{  
					xtype:'hiddenfield',
					name:'config',
					value: 'warrnamboolgis'
				}]
			}]
			,            
			dockedItems: [{
				xtype: 'toolbar',
				dock: 'bottom',
				items: [
					{
						text: 'Cancel',
						handler: function() {
							Ext.getCmp('form_pit_capture').reset();
							app.capturePitFormPopupPanel.hide();
						}
					},
					{xtype: 'spacer'},
					{
						text: 'Save',
						ui: 'confirm',
						handler: function() {
							// Sending all that to the web service endpoint
							Ext.getCmp('form_pit_capture').submit({
								url: '/ws/rest/v3/ws_create_drainage_pit.php',
								method: 'POST',
								submitEmptyText: false,
								waitMsg: 'Saving ...',
								success: on_capture_success,
								failure: on_capture_failure
							});
						}
					}
				]
			}]
		});
        
		var on_capture_success = function(form, action){
			Ext.getCmp('form_pit_capture').reset();
			app.capturePitFormPopupPanel.hide();
			
			// Reload the vector layer - it should contain the new point
			getFeatures();
		};

		var on_capture_failure = function(form, action){
			alert("Capture failed");
		};
        
		this.items = [{
			xtype: 'panel',
			layout: 'fit',
			items: [this.formContainer]
		}];
		App.CapturePitFormPopupPanel.superclass.initComponent.call(this);
	}
});
