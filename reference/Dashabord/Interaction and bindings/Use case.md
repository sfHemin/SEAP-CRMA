Bind Parts of a Query
# Bind Parts of a Query

You can dynamically set parts of a query based on the selection or results of another query. For example, you can set the grouping in a query based on the grouping selected in a chart.

Before we discuss how to bind the different parts of the query, let’s look at a comprehensive example. This example illustrates the interactions for different parts of a query. The chart is bound based on selections for grouping, measure, filter, order, and limit. When you make a selection in one of the toggle widgets, the chart changes to show the results of the modified query.

![The dashboard shows toggle widgets that dynamically modify the chart's query based on selections of groupings, measures, filters, orders, and limits.](https://a.sfdcstatic.com/developer-website/sfdocs/analytics/media/bi_dashboard_binding_query_parts_flex.png)

Here’s the JSON for the queries that power this dashboard. The `Account_BillingCount_1` query is the underlying query for the chart widget. This query contains multiple interactions based on other queries.

```json
"steps": {
    "Account_BillingCount_1": {
        "datasets": [
            {
                "id": "0FbB00000000oEkKAI",
                "label": "Opportunities",
                "name": "opportunity",
                "url": "/services/data/v38.0/wave/datasets/0FbB00000000oEkKAI"
            }
        ],
        "isFacet": true,
        "isGlobal": false,
        "query": {
            "measures": "{{column(StaticMeasureNames.selection, [\\"value\\"]).asObject()}}",
            "limit": "{{column(StaticLimits.selection, [\\"value\\"]).asObject()}}",
            "groups": "{{column(StaticGroupingNames.selection, [\\"value\\"]).asObject()}}",
            "filters": "{{column(StaticFilters.selection, [\\"value\\"]).asObject()}}",
            "order": "{{column(StaticOrdering.selection, [\\"value\\"]).asObject()}}"
        },
        "selectMode": "single",
        "type": "aggregateflex",
        "useGlobal": true,
        "visualizationParameters": {
            "visualizationType": "hbar",
            "options": {}
        }
    },
    "StaticGroupingNames": {
        "datasets": [],
        "dimensions": [],
        "isFacet": true,
        "isGlobal": false,
        "selectMode": "single",
        "start": {
            "display": [
                "Country"
            ]
        },
        "type": "staticflex",
        "useGlobal": true,
        "values": [
            {
                "display": "Country",
                "value": "Account.BillingCountry"
            },
            {
                "display": "Industry",
                "value": "Account.Industry"
            },
            {
                "display": "Product",
                "value": "Product.Product.Family"
            },
            {
                "display": "Source",
                "value": "Account.AccountSource"
            }
        ],
        "visualizationParameters": {
            "options": {}
        }
    },
    "StaticFilters": {
        "datasets": [],
        "dimensions": [],
        "isFacet": true,
        "isGlobal": false,
        "selectMode": "single",
        "start": {
            "display": "Ads Only"
        },
        "type": "staticflex",
        "useGlobal": true,
        "values": [
            {
                "display": "Ads Only",
                "value": [
                    "LeadSource",
                    [
                        "Advertisement"
                    ],
                    "in"
                ]
            },
            {
                "display": "Partners Only",
                "value": [
                    "Account.Type",
                    [
                        "Partner"
                    ],
                    "in"
                ]
            },
            {
                "display": "$1M+ Only",
                "value": [
                    "Amount",
                    [
                        [
                            1000000,
                            11921896
                        ]
                    ],
                    ">=<="
                ]
            }
        ],
        "visualizationParameters": {
            "options": {}
        }
    },
    "StaticOrdering": {
        "datasets": [],
        "dimensions": [],
        "isFacet": true,
        "isGlobal": false,
        "selectMode": "single",
        "start": {
            "display": "Ads Only"
        },
        "type": "staticflex",
        "useGlobal": true,
        "values": [
            {
                "display": "Ascending",
                "value": [
                    -1,
                    {
                        "ascending": true
                    }
                ]
            },
            {
                "display": "Descending",
                "value": [
                    -1,
                    {
                        "ascending": false
                    }
                ]
            }
        ],
        "visualizationParameters": {
            "options": {}
        }
    },
    "StaticLimits": {
        "datasets": [],
        "dimensions": [],
        "isFacet": true,
        "isGlobal": false,
        "selectMode": "single",
        "start": {
            "display": [
                "5"
            ]
        },
        "type": "staticflex",
        "useGlobal": true,
        "values": [
            {
                "display": "5",
                "value": 5
            },
            {
                "display": "10",
                "value": 10
            },
            {
                "display": "25",
                "value": 25
            }
        ],
        "visualizationParameters": {
            "options": {}
        }
    },
    "StaticMeasureNames": {
        "datasets": [],
        "dimensions": [],
        "isFacet": true,
        "isGlobal": false,
        "selectMode": "singlerequired",
        "start": {
            "display": [
                "Total Amount"
            ]
        },
        "type": "staticflex",
        "useGlobal": true,
        "values": [
            {
                "display": "Max Employees",
                "value": [
                    "max",
                    "Account.NumberOfEmployees"
                ]
            },
            {
                "display": "Total Amount",
                "value": [
                    "sum",
                    "Amount"
                ]
            },
            {
                "display": "Avg Amount",
                "value": [
                    "avg",
                    "Amount"
                ]
            }
        ],
        "visualizationParameters": {
            "options": {}
        }
    },
    "Account_AccountSourc_1": {
        "datasets": [
            {
                "id": "0FbB00000000oEkKAI",
                "label": "Opportunities",
                "name": "opportunity",
                "url": "/services/data/v38.0/wave/datasets/0FbB00000000oEkKAI"
            }
        ],
        "isFacet": true,
        "isGlobal": false,
        "query": {
            "measures": [
                [
                    "count",
                    "*"
                ]
            ],
            "groups": [
                "Account.AccountSource"
            ],
            "order": [
                [
                    -1,
                    {
                        "ascending": false
                    }
                ]
            ]
        },
        "type": "aggregateflex",
        "useGlobal": true,
        "visualizationParameters": {
            "visualizationType": "hbar",
            "options": {}
        }
    }
},
"widgetStyle": {
    "backgroundColor": "#FFFFFF",
    "borderColor": "#E6ECF2",
    "borderEdges": [],
    "borderRadius": 0,
    "borderWidth": 1
}
```

:::note
If you bind a measure or grouping in a query used for a chart, you must also replace the `columnMap` section in the widget-level chart JSON with an empty `columns` array. For more information, see [Measure Interactions](/docs/analytics/bi-dev-guide-bindings/guide/bi-dashboard-bindings-wave-designer-use-case-measure.md) and [Group Interactions](/docs/analytics/bi-dev-guide-bindings/guide/bi-dashboard-bindings-wave-designer-use-case-group.md).
:::
# Measure Interactions

Bind the measure to allow the dashboard viewer to select which measures to show in a widget. For example, you can show different measures in a chart based on the selection in a toggle widget.

To dynamically set the measure in a query based on a selection, complete these tasks.

- Bind the `measures` property of the query.
- If the query is used for a chart, replace the `columnMap` section of the widget with an empty `columns` array. Why? Because when you change the query, the set of fields is different from what’s in the `columnMap` section. When you replace the `columnMap` property with an empty `columns` array, the system remaps the columns based on the new query definition.
- Binding isn’t allowed using the `columnMap` property.

Let’s look at an example where we bind the measure for a donut chart based on the selection in the toggle widget.

![The toggle widgets allow you to choose a measure to display in the map chart.](https://a.sfdcstatic.com/developer-website/sfdocs/analytics/media/bi\_212\_chart_bindings.png)

The toggle widget uses this custom query.

```json
"MeasuresController_1": {
    "type": "staticflex",
    "label": "MeasuresController",
    "values": [
        {
            "display": "Total Amount",
            "step_property": [ "sum", "Amount" ]
        },
        {
            "display": "Average Amount",
            "step_property": [ "avg", "Amount" ]
        },
        {
            "display": "Count of Rows",
            "step_property": [ "count", "*" ]
        }
    ],
    "selectMode": "singlerequired",
    "start": {
        "display": [ "Total Amount" ]
    },
    "broadcastFacet": true,
    "groups": [],
    "numbers": [],
    "strings": []
}
```

Each toggle option has one display label (`display`) that appears in the toggle. It also has one value (`step_property`) that determines the measure.

Let’s bind the `step_property` field of the custom query (`MeasuresController_1`) to the measure in the donut chart’s step (`PieByProduct_2`). Any selection in the custom query passes the aggregation method (like sum or count) and the measure field to the `PieByProduct_2` query.

```json
"PieByProduct_2": {
    "label": "PieByProduct_2",
    "query": {
        "measures": [
            "{{ cell(MeasuresController_1.selection, 0, \\"step_property\\").asObject() }}"
        ],
        "groups": [ "Product" ]
    },
    "visualizationParameters": {

        ...

    },
    "receiveFacet": true,
    "selectMode": "single",
    "type": "aggregateflex",
    "isGlobal": false,
    "useGlobal": true,
    "broadcastFacet": true,
    "datasets": [
        {
            "id": "0FbB00000000q5gKAA",
            "label": "Flexy Sales",
            "name": "Flexy_Sales",
            "url": "/services/data/v42.0/wave/datasets/0FbB00000000q5gKAA"
        }
    ]
}
```

When you create the donut chart, by default, the widget (`chart_2`) contains the `columnMap` section that maps measures and groupings to chart attributes.

```json
"chart_2": {
    "type": "chart",
    "parameters": {
        "visualizationType": "pie",
        "step": "PieByProduct_2",
        "columnMap": {
            "trellis": [],
            "dimension": [ "Product" ],
            "plots": [ "sum_Amount" ]
        },

        ...

        }
    }
}
```

:::note
The properties under the `columnMap` property vary based on the chart type.
:::

For the interaction to work correctly, replace the `columnMap` section with an empty `columns` array because interactions can’t be used to specify `columnMap`.

```json
"chart_2": {
    "type": "chart",
    "parameters": {
        "visualizationType": "pie",
        "step": "PieByProduct_2",
        "columns" : [],

        ...

        }
    }
}
```
# Equality Filter Interactions

You can bind filters based on certain conditions. CRM Analytics supports multiple operators that provide flexibility when defining the conditions.

## Filter Example (SAQL Form)

Let's say you have these results from the source query.

```json
[
    {grouping: "first", measure: 19}
    {grouping: "second", measure: 32}
]
```

You can bind a filter using the `asEquality()` interaction function. This filter condition determines whether the returned value equals `“bar"`.

```javascript
q = filter q by {{cell(stepFoo.selection, 1, "measure").asEquality("bar")}};
```

After evaluating the interaction based on the data returned from the source query, CRM Analytics produces this filter.

```javascript
q = filter q by bar == 32;
```

:::note
If a selection returns multiple values, `asEquality()` inserts the `'in'` operator, instead of `==`, in the filter statement. For example, this filter condition determines if any value in the `“grouping”` column equals `“bar”`.

```javascript
q = filter q by {{column(stepFoo.selection, ["grouping"]).asEquality("bar")}};
```

If the selection returns `first` and `second`, the filter becomes:

```javascript
q = filter q by bar in ["first","second"];
```
:::

## Filter Example with the `in` Operator (Compact Form)

Let’s say you want to filter the Case by Status widget in this dashboard based on the account selected in the Account list widget.

![The Account list widget filters the other widgets in the dashboard based on the selected account.](https://a.sfdcstatic.com/developer-website/sfdocs/analytics/media/bi_dashboard_binding_query_filter_compact_form.png)

Faceting doesn’t work in this case because the queries on these widgets are based on different datasets. To enable filtering, create an interaction in the Cases by Status widget’s query (`Status_1`) based on the selection in the Account widget’s query (`AccountId_Name_1`). This interaction compares the value of the `AccountId.Name` field in the `Status_1` query to the selected values in the `AccountId.Name` field of the `AccountId_Name_1` query. Because there can be multiple selected account names, use the `in` operator.

```json
"steps": {
	"Status_1": {
		"datasets": [{
			"id": "0FbB00000000rlDKAQ",
			"label": "CasesAccounts",
			"name": "CasesAccounts",
			"url": "/services/data/v38.0/wave/datasets/0FbB00000000rlDKAQ"
		}],
		"isFacet": true,
		"isGlobal": false,
		"query": {
			"measures": [
				[
					"count",
					"*"
				]
			],
			"groups": [
				"Status"
			],
			"filters": [
				[
					"AccountId.Name",
					"{{column(AccountId_Name_1.selection, [\\"AccountId.Name\\"]).asObject()}}",
					"in"
				]
			]
		},
		"type": "aggregateflex",
		"useGlobal": true,
		"visualizationParameters": {
			"visualizationType": "hbar",
			"options": {}
		}
	},
	"AccountId_Name_1": {
		"datasets": [{
			"id": "0FbB00000000rlIKAQ",
			"label": "OpptiesAccountsSICsUsers",
			"name": "OpptiesAccountsSICsUsers",
			"url": "/services/data/v38.0/wave/datasets/0FbB00000000rlIKAQ"
		}],
		"isFacet": true,
		"isGlobal": false,
		"query": {
			"measures": [
				[
					"count",
					"*"
				]
			],
			"groups": [
				"AccountId.Name"
			]
		},
		"selectMode": "single",
		"type": "aggregateflex",
		"useGlobal": false,
		"visualizationParameters": {
			"options": {}
		}
	}
...
```

## Filter Example with an Inequality Operator (SAQL Form)

Let's say you have these results from a source query.

```json
[ {grouping: "first", measure: 19} {grouping: "second", measure: 32} ]
```

You can create a filter interaction using on an inequality operator.

```javascript
q = filter q by bar > {{cell(queryFoo.selection, 1, "measure").asString()}};
```

After evaluating the interaction, the filter becomes:

```javascript
q = filter q by bar > 32;
```

## Filter Example with the `matches` Operator (SAQL Form)

Let's say you have these results from a source query.

```json
[ {grouping: "first", measure: 19} {grouping: "second", measure: 32} ]
```

You can create a filter interaction using on the matches operator.

```javascript
q = filter q by bar matches "{{cell(queryFoo.selection, 1, "grouping").asString()}}";
```

After evaluating the interaction, the filter results are:

```javascript
q = filter q by bar matches "second";
```
# Range Filter Interactions

Use the `asRange()` serialization function to bind filters based on numeric ranges.

Let’s look at some examples with inclusive ranges.

The source query for an interaction produces these results.

```json
[ {grouping: "first", measure: 19} {grouping: "second", measure: 32} ]
```

You can bind the filter using this syntax.

```javascript
q = filter q by {{row(stepFoo.selection, [0], ["min", "max"]).asRange("bar")}};
```

After evaluating the interaction, CRM Analytics produces this range filter.

```javascript
q = filter q by bar >= 19 && bar <= 32;
```
# Date Range Filter Interactions

Use the `asDateRange()` serialization function to bind filters based on date ranges. You can create filters using absolute or relative date ranges.

If the input data is a one-dimensional array with two elements:

- And both elements are numbers, CRM Analytics assumes the numbers are epoch times. `[1016504910000, 1016504910000]` results in `fieldName in [dateRange([2002,3,19], [2010,8,12])]`.
- Otherwise, the first element is used as the minimum and the second element is used as the maximum. `["current day", "1 month ahead"]` results in `fieldName in ["current day".."1 month ahead"]`. If one of the elements is null, the date range is open-ended. `["1 month ago", null]` results in `fieldName in ["1 month ago"..]`.

If the input data is a two-dimensional array where the outer array has two elements:

- And both nested arrays have two elements, CRM Analytics assumes the data is in the relative date array format. `[["year", -2], ["year", 1]]` results in`fieldName in ["2 years ago".."1 year ahead"]`.
- And both nested arrays have 3 elements, the nested arrays are passed to the SAQL `dateRange()` function. `[[2015, 2, 1], [2016, 2, 1]]` results in `fieldName in [dateRange([2015,2,1], [2016,2,1])]`.

If the input data is `null`, the result is `fieldName in all`, which doesn’t filter anything.

## Binding to a Date Filter Widget

For instance, let’s say you make a selection in a date widget that returns this absolute date range (in epoch format).

```json
[ {min: 1016504910000, max: 1281655993000} ]
```

You can create a filter using the returned selection data.

```javascript
q = filter q by {{row(queryFoo.selection, [0], ["min", "max"]).asDateRange("date(year, month, day)")}};
```

After evaluating the binding, CRM Analytics produces this date range filter.

```javascript
q = filter q by date(year, month, day) in [dateRange([2002,3,19], [2010,8,12])];
```

For relative dates, assume that the date widget returns these relative datas based on your selection.

```json
[ {min: ["quarter", -2], max: ["quarter", 3]} ]
```

After evaluation, this data range filters results.

```javascript
q = filter q by date(year, month, day) in ["2 quarters ago".."3 quarters ahead"];
```

## Binding to a Custom List of Date Ranges

Create a custom query with rows for each custom date range. You can specify ranges using absolute or relative dates.

To filter with absolute ranges, the results of the custom query must return absolute dates.

```json
[
    {label: "8/30/15 - 8/30/16", range: [[2015, 8, 30], [2016, 8, 30]]}
    {label: "7/30/16 - 8/30/16", range: [[2016, 7, 30], [2016, 8, 30]]}
]
```

You can create the filter based on the selected value of the source query.

```javascript
q = filter q by {{cell(queryFoo.selection, 0, "range").asDateRange("date(year, month, day)")}};
```

After CRM Analytics evaluates the binding, the filter is as shown.

```javascript
q = filter q by date(year, month, day) in [dateRange([2015, 8, 30], [2016, 8, 30])];
```

To filter with relative ranges, the source query results must be as shown.

```json
[
    {"label": "YTD", "range": ["1 year ago", "current day"]}
    {"label": "MTD", "range": ["1 month ago", "current day"]}
    {"label": "Everything up to today", "range": [null, "current day"]}
]
```

You can use this binding to create a filter based on the selected value of the source query.

```javascript
q = filter q by {{cell(queryFoo.selection, 0, "range").asDateRange("date(year, month, day)")}};
```

After CRM Analytics evaluates the binding, the filter becomes:

```javascript
q = filter q by date(year, month, day) in ["1 year ago".."current day"];
```

You can also create an open-ended range filter by specifying null as one of the relative date keywords in the source query. The bound filter is as shown.

```javascript
q = filter q by {{cell(queryFoo.selection, 2, "range").asDateRange("date(year, month, day)")}};
```

After CRM Analytics evaluates the binding, the filter becomes:

```javascript
q = filter q by date(year, month, day) in [.."current day"];
```

:::note
The SAQL function [`date_to_epoch()`](https://developer.salesforce.com/docs/atlas.en-us.bi_dev_guide_saql.meta/bi_dev_guide_saql/bi_saql_functions_date2epoch.htm) returns epoch seconds, but date range filters bindings require milliseconds.
:::
# Projection Interactions

Use the `asProjection()` serialization function to specify the projection of a field in a SAQL query.

Given this data from a source query:

```json
[
    {expression: "first", alias: "foo"}
    {expression: "second", alias: "bar"}
]
```

You can bind the projection of a field in a target query.

```javascript
q = foreach q generate {{row(stepFoo.selection, [0], ["expression", "alias"]).asProjection()}};
```

After CRM Analytics evaluates the interaction, the projection becomes:

```javascript
q = foreach q generate first as 'foo';
```

To return all rows in the interaction, create this filter.

```javascript
q = foreach q generate {{row(stepFoo.selection, [], ["expression", "alias"]).asProjection()}};
```

After CRM Analytics evaluates the interaction, the filter becomes:

```javascript
q = foreach q generate first as 'foo', second as 'bar';
```
# Group Interactions

Bind the grouping to allow the dashboard viewer to select which dimensions to group the results by. For example, you can show different groupings in a chart based on the selection in a toggle widget.

To dynamically set the grouping in a query based on a selection, bind the `groups` property in the query. If the query is used for a chart, also bind the corresponding widget property under `columnMap` to identify the chart attribute by the selected grouping. Some charts accept multiple groupings and use them differently. For example, the stacked bar chart can have two groupings, one for the vertical axis and one used to segment the bars. The `columnMap` widget-level property has subproperties that specify which grouping to use for each of these chart attributes.

To dynamically set the grouping in a query based on a selection, complete these tasks.

- Bind the `groups` property of the query.
- If the query is used for a chart, replace the `columnMap` section of the widget with an empty `columns` array. Why? Because when you change the query, the set of fields can be different from what’s in the `columnMap` section. When you replace the `columnMap` property with an empty `columns` array, the system remaps the columns based on the new query definition.

For example, let’s bind the grouping for this donut chart based on the selection in the toggle widget.

![The toggle widgets allow you to choose a measure to display in the map chart.](https://a.sfdcstatic.com/developer-website/sfdocs/analytics/media/bi_dashboard_grouping_binding_flex.png)

:::note
Dashboard selections automatically reset each time you change your query grouping. For example, if you drill into Air Up and then switch your grouping to Country, the donut chart resets and Air Up is no longer selected.
:::

The toggle widget uses this custom query.

```json
"GroupingsController_1": {
    "type": "staticflex",
    "values": [
        {
            "display": "Country",
            "value": "Country"
        },
        {
            "display": "Product",
            "value": "Product"
        },
        {
            "display": "Rep Name",
            "value": "Referral"
        }
    ],
    "start": {
        "display": [ "Product" ]
    },
    "broadcastFacet": true,
    "groups": [],
    "label": "GroupingsController",
    "numbers": [],
    "selectMode": "singlerequired",
    "strings": []
}
```

Each toggle option has one display label (`display`) that appears in the toggle. It also has one value (`value`) that determines the grouping.

Let’s bind the `value` field of the custom query (`GroupingsController_1`) to the grouping in the donut chart’s query (`PieByProduct_2`). Any selection in the custom query passes the grouping to the `PieByProduct_2` query.

```json
"PieByProduct_2": {
    "label": "PieByProduct",
    "query": {
        "measures": [[
            "sum",
            "Amount"
        ]],
        "groups": [
            "{{ cell(GroupingsController_1.selection, 0, \\"value\\").asString() }}"
        ]
    },
    "broadcastFacet": true,
    "isGlobal": false,
    "receiveFacet": true,
    "selectMode": "single",
    "type": "aggregateflex",
    "useGlobal": true,
    "visualizationParameters": {
        "type": "chart",
        "parameters": {

            ...

        },
        "options": {}
    },
    "datasets": [
        {
            "id": "0FbB00000000q5gKAA",
            "label": "Flexy Sales",
            "name": "Flexy_Sales",
            "url": "/services/data/v42.0/wave/datasets/0FbB00000000q5gKAA"
        }
    ]
}
```

When you create the donut chart, by default, the widget (`chart_3`) contains the `columnMap` section that maps measures and groupings to chart attributes.

```json
"chart_3": {
    "type": "chart",
    "parameters": {
        "visualizationType": "pie",
        "step": "PieByProduct_2",
        "theme": "wave",
        "columnMap": {
            "trellis": [],
            "dimension": [
                "{{ cell(GroupingsController_1.selection, 0, \\"value\\").asString() }}"
            ],
            "plots": [ "sum_Amount" ]
        },

        ...

    }
}
```

:::note
The properties under the `columnMap` property vary based on the chart type.
:::

For the interaction to work correctly, replace the `columnMap` section with an empty `columns` array.

```json
"chart_3": {
    "type": "chart",
    "parameters": {
        "visualizationType": "pie",
        "step": "PieByProduct_2",
        "theme": "wave",
        "columns" : [],

        ...

    }
}
```
# Order Interactions

Use the `asOrder()` serialization function to specify the sort order in a SAQL query.

Let’s look at an example where the selection in a toggle widget determines the sort order in a SAQL query.

Given this data from a source query:

```json
[
    {order: "first", direction: "desc"}
    {order: "second", direction: "asc"}
]
```

To order by a single field, apply this order logic. When you don’t specify the direction in the query, the default is ascending.

```javascript
q = order q by {{cell(stepFoo.selection, 1, "order").asOrder()}};
```

After CRM Analytics evaluates the interaction, the grouping becomes:

```javascript
q = order q by 'second';
```

To order by multiple fields, use this grouping logic.

```javascript
q = order q by {{column(stepFoo.selection, ["order"]).asOrder()}};
```

After CRM Analytics evaluates the interaction, the grouping becomes:

```javascript
q = order q by ('first', 'second');
```

To specify the order and the direction, use this grouping logic.

```javascript
q = order q by {{row(stepFoo.selection, [], ["order", "direction"]).asOrder()}};
```

After CRM Analytics evaluates the interaction, the grouping becomes:

```javascript
q = order q by ('first' desc, 'second' asc);
```
# Limit and Offset Interactions

You can also bind the limit and offset of a SAQL query. These interactions don’t require data serialization functions.

Consider a source query that provides this data.

```json
[ {limit: 100, offset: 10} ]
```

To bind the limit and offset, use this logic.

```javascript
q = limit q {{cell(stepFoo.selection, 0, "limit").asString()}};
q = offset q {{cell(stepFoo.selection, 0, "offset").asString()}};
```

After CRM Analytics evaluates the interaction, the limit and offset become:

```javascript
q = limit q 100; q = offset q 10;
```

For information about limits and offsets, see the [CRM Analytics SAQL Developer Guide](https://developer.salesforce.com/docs/atlas.en-us.bi_dev_guide_saql.meta/bi_dev_guide_saql/bi_saql_intro.htm).
# Measure and Group Bindings in Compact-Form and SAQL-Form Queries

You can use bindings in compact-form queries and SAQL-form queries.

Let's look at an example where the selections in two custom queries (`StaticSAQLMeasureNames` and `StaticSAQLGroupingNames`) determine the measure and grouping of a SAQL-form query. Notice that the bindings for both measures and groups are defined in two places. To learn more about strings, numbers, and groups fields, see [SAQL Step Type Properties](https://developer.salesforce.com/docs/atlas.en-us.bi_dev_guide_json.meta/bi_dev_guide_json/bi_dbjson_steps_types_saql.htm).

```json
{
    "label": "New dashboard",
    "mobileDisabled": false,
    "state": {
        "steps": {
            "lens_1": {
                "type": "saql",
                "query": "q = load \"OpportunityWithAccount\";\nq = group q by {{column(StaticSAQLGroupingNames.selection, [\"value\"]).asGrouping()}};\nq = foreach q generate {{row(StaticSAQLGroupingNames.selection, [], [\"expression\", \"alias\"]).asProjection()}}, {{row(StaticSAQLMeasureNames.selection, [], [\"expression\", \"alias\"]).asProjection()}};\nq = order q by ‘AccountId.Industry’ asc;\nq = limit q 2000;",
                "useGlobal": true,
                "numbers": "{{column(StaticSAQLMeasureNames.selection, [\"alias\"]).asObject()}}",
                "groups": "{{column(StaticSAQLGroupingNames.selection, [\"alias\"]).asObject()}}",
                "strings": "{{column(StaticSAQLGroupingNames.selection, [\"alias\"]).asObject()}}",
                "visualizationParameters": {},
                "selectMode": "single",
                "broadcastFacet": true,
                "receiveFacetSource": {
                    "mode": "all",
                    "steps": []
                }
            },
            "StaticSAQLMeasureNames": {
                "datasets": [],
                "dimensions": [],
                "isFacet": true,
                "isGlobal": false,
                "selectMode": "singlerequired",
                "start": {
                    "display": [
                        "Total Amount"
                    ]
                },
                "type": "staticflex",
                "useGlobal": true,
                "values": [
                    {
                        "display": "Total Amount",
                        "cf": [
                            "sum",
                            "Amount"
                        ],
                        "expression": "sum(‘Amount’)",
                        "alias": "sum_Amount"
                    },
                    {
                        "display": "Avg Amount",
                        "cf": [
                            "avg",
                            "Amount"
                        ],
                        "expression": "avg(‘Amount’)",
                        "alias": "avg_Amount"
                    }
                ],
                "numbers": [],
                "strings": [],
                "groups": [],
                "columns": {},
                "broadcastFacet": true
            },
            "StaticSAQLGroupingNames": {
                "datasets": [],
                "dimensions": [],
                "isFacet": true,
                "isGlobal": false,
                "selectMode": "multirequired",
                "start": {
                    "display": [
                        "Country"
                    ]
                },
                "type": "staticflex",
                "useGlobal": true,
                "values": [
                    {
                        "display": "Industry",
                        "value": "AccountId.Industry",
                        "expression": "‘AccountId.Industry’",
                        "alias": "AccountId.Industry"
                    },
                    {
                        "display": "Source",
                        "value": "AccountId.AccountSource",
                        "expression": "‘AccountId.AccountSource’",
                        "alias": "AccountId.AccountSource"
                    }
                ],
                "numbers": [],
                "strings": [],
                "groups": [],
                "columns": {},
                "broadcastFacet": true
            }
        },
        "widgets": {
            "pillbox_3": {
                "type": "pillbox",
                "parameters": {
                    "compact": false,
                    "showActionMenu": true,
                    "exploreLink": false,
                    "fontSize": 14,
                    "textColor": "#0070D2",
                    "selectedTab": {
                        "textColor": "#FFFFFF",
                        "backgroundColor": "#0070D2",
                        "borderEdges": [
                            "all"
                        ],
                        "borderColor": "#C6D3E1",
                        "borderWidth": 1
                    },
                    "step": "StaticSAQLGroupingNames"
                }
            },
            "pillbox_4": {
                "type": "pillbox",
                "parameters": {
                    "compact": false,
                    "showActionMenu": true,
                    "exploreLink": false,
                    "fontSize": 14,
                    "textColor": "#0070D2",
                    "selectedTab": {
                        "textColor": "#FFFFFF",
                        "backgroundColor": "#0070D2",
                        "borderEdges": [
                            "all"
                        ],
                        "borderColor": "#C6D3E1",
                        "borderWidth": 1
                    },
                    "step": "StaticSAQLMeasureNames"
                }
            },
            "chart_1": {
                "type": "chart",
                "parameters": {
                    "visualizationType": "hbar",
                    "title": {
                        "label": "",
                        "fontSize": 14,
                        "subtitleLabel": "",
                        "subtitleFontSize": 11,
                        "align": "center"
                    },
                    "theme": "wave",
                    "showValues": true,
                    "axisMode": "multi",
                    "autoFitMode": "keepLabels",
                    "binValues": false,
                    "bins": {
                        "breakpoints": {
                            "low": 0,
                            "high": 100
                        },
                        "bands": {
                            "low": {
                                "label": "",
                                "color": "#B22222"
                            },
                            "medium": {
                                "label": "",
                                "color": "#FFA500"
                            },
                            "high": {
                                "label": "",
                                "color": "#008000"
                            }
                        }
                    },
                    "dimensionAxis": {
                        "showAxis": true,
                        "showTitle": true,
                        "title": "",
                        "customSize": "auto",
                        "icons": {
                            "useIcons": false,
                            "iconProps": {
                                "column": "",
                                "fit": "cover",
                                "type": "round"
                            }
                        }
                    },
                    "measureAxis1": {
                        "sqrtScale": false,
                        "showAxis": true,
                        "customDomain": {
                            "showDomain": false
                        },
                        "showTitle": true,
                        "title": ""
                    },
                    "measureAxis2": {
                        "sqrtScale": false,
                        "showAxis": true,
                        "customDomain": {
                            "showDomain": false
                        },
                        "showTitle": true,
                        "title": ""
                    },
                    "legend": {
                        "show": true,
                        "showHeader": true,
                        "inside": false,
                        "descOrder": false,
                        "position": "right-top",
                        "customSize": "auto"
                    },
                    "tooltip": {
                        "customizeTooltip": false,
                        "showDimensions": true,
                        "dimensions": "",
                        "showMeasures": true,
                        "measures": "",
                        "showPercentage": true,
                        "showNullValues": true,
                        "showBinLabel": true
                    },
                    "trellis": {
                        "enable": false,
                        "showGridLines": true,
                        "flipLabels": false,
                        "type": "x",
                        "chartsPerLine": 4,
                        "size": [
                            100,
                            100
                        ]
                    },
                    "applyConditionalFormatting": true,
                    "showActionMenu": true,
                    "exploreLink": true,
                    "step": "lens_1"
                }
            }
        },
        "filters": [],
        "gridLayouts": [
            {
                "name": "Default",
                "numColumns": 12,
                "rowHeight": "normal",
                "version": 1,
                "pages": [
                    {
                        "label": "Untitled",
                        "name": "36d03d4a-cdce-427e-b338-4ae29db1ba26",
                        "widgets": [
                            {
                                "row": 0,
                                "column": 6,
                                "rowspan": 2,
                                "colspan": 6,
                                "name": "pillbox_3",
                                "widgetStyle": {}
                            },
                            {
                                "row": 2,
                                "column": 6,
                                "rowspan": 2,
                                "colspan": 6,
                                "name": "pillbox_4",
                                "widgetStyle": {}
                            },
                            {
                                "row": 0,
                                "column": 0,
                                "rowspan": 4,
                                "colspan": 6,
                                "name": "chart_1",
                                "widgetStyle": {}
                            }
                        ],
                        "navigationHidden": false
                    }
                ],
                "selectors": [],
                "style": {
                    "backgroundColor": "#F2F6FA",
                    "gutterColor": "#C5D3E0",
                    "cellSpacingX": 8,
                    "cellSpacingY": 8,
                    "fit": "original",
                    "alignmentX": "left",
                    "alignmentY": "top"
                }
            }
        ],
        "dataSourceLinks": [],
        "widgetStyle": {
            "backgroundColor": "#FFFFFF",
            "borderEdges": [],
            "borderColor": "#E6ECF2",
            "borderWidth": 1,
            "borderRadius": 0
        }
    },
    "datasets": [
        {
            "id": "Edgemart13",
            "name": "OpportunityWithAccount",
            "label": "Opportunity With Accounts",
            "url": "../../WaveCommon/repo/edgemarts/OpportunityWithAccount/OpportunityWithAccountEM"
        }
    ]
}

```

:::note
If you bind a measure or grouping in a compact-form or SAQL-form step used for a chart, you must also replace the `columnMap` section in the widget-level chart JSON with an empty `columns` array. For more information, see [Measure Interactions](/docs/analytics/bi-dev-guide-bindings/guide/bi-dashboard-bindings-wave-designer-use-case-measure.md) and [Group Interactions](/docs/analytics/bi-dev-guide-bindings/guide/bi-dashboard-bindings-wave-designer-use-case-group.md).
:::

:::note
If you provide an aggregate function for a measure, then the measure value must be a string, not an array.
:::
