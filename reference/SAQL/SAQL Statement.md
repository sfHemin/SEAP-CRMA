SAQL Reference
SAQL Statements
Sub-Category
Count of Rows
Machines
115
Paper
1,370
Phones
889
Storage
846
Supplies
190
Tables
319
Empty
4
SEE ALSO:
filter
group-by rollup
group-by
SAQL Statements
A query is made up of statements. Each SAQL statement has an input stream, an operation, and an output stream.
arimax
Uses existing data to predict future data points. The arimax statement must follow a projection statement in your query. Perform
any filtering pre-projection or after the arimax statement.
cogroup
common field.
Use cogroup to blend data from two or more data streams into a single data stream. The data streams must have at least one
fill
Use fill() to fill in any gaps in date fields. You most often use fill() before using the timeseries statement. By specifying
the date fields to check, fill() creates a row that contains the missing month, day, week, quarter, or year and includes a null
value. To include values outside the bounds of your data’s date range, specify a start date and end date to override existing limits.
The function returns the missing date rows with null values.
filter
Selects rows from a dataset based on a filter predicate.
foreach
Applies a set of expressions to every row in a dataset. This action is often referred to as projection.
group-by
Organizes the rows returned from a query into groups. Within each group, you can apply an aggregate function, such as count()
or sum() to get the number of items or sum, respectively.
group-by rollup
rollup is a subclause of group-by that creates and displays aggregations of grouped data. The output of rollup is based
on column order in your query.
38
SAQL Reference
arimax
join semi and anti
limit
load
Use the join statement with the join_type to create semi-join or anti-join results.
Limits the number of results that are returned. If you don’t set a limit, queries return a maximum of 10,000 rows.
Loads a dataset. All SAQL queries start with a load statement.
offset
Use offset to page through the results of your query.
order
Sorts in ascending or descending order on one or more fields.
sample
the Bernoulli distribution.
Returns a random sample from a large dataset, where each data point has an equal probability of being selected. This keyword uses
timeseries
Uses existing data to predict future data points. The timeseries statement must follow a projection statement in your query.
Perform any filtering pre-projection or after the timeseries statement.
union
Combines multiple result sets into one result set. The result sets must have the same field names and structure. You can use a different
dataset to create each result set, or you can use the same dataset.
arimax
Uses existing data to predict future data points. The arimax statement must follow a projection statement in your query. Perform any
filtering pre-projection or after the arimax statement.
Note: The arimax statement requires a CRM Analytics Growth or CRM Analytics Plus license to return a full set of results.
Usage
arimax is a variant of the timeseries statement that provides a different algorithm to predict data points. Use arimax when
you want predictions performed with a more general model that can take multiple variables.
Syntax
result = arimax resultSet generate measure1 as fmeasure1 with (parameters);
parameters can have these values:
• arimaOrder (required if seasonalOrder isn’t specified) Specify the order for the ARIMA model. For example,
arimaOrder=(p,d,q), where p, d, and q are integers. The integer values must be between 0 and 5.
Note: p is the AR order, d is the degree of differencing, and q is the MA order.
• seasonalOrder (required if arimaOrder isn’t specified) Specify the seasonal order for the ARIMA model. For example,
seasonalOrder=(P,D,Q,s), where P, D, Q are integers and s is the period. The integer values must be between 0 and
5. The s value must be 0 or between 2 and 24. s can only be 0 when P, D, and Q are also all 0.
39
SAQL Reference
arimax
Note: P is the seasonal AR order, D is the degree of seasonal differencing, Q is the seasonal MA order, and s is the seasonal
periodicity.
• xreg (optional) External regressors or co-factors. For example, xreg=('col1','col2',...). The values for xreg must
be measures. The maximum number of xreg fields allowed is 10.
• xregFutures (optional) Future scenario data for the xreg parameter as a map of values arrays. The number of values in each
array must match the value for the length parameter. The key for each array value is the name of an xreg measure.
Note: If seasonalOrder and dateType aren’t specified in the query, the algorithm runs an auto-param search on a few
popular seasonalities to find the best fit.
arimax also supports the following timeseries parameters, with the same meaning and behavior.
• length (required) Number of points to predict. For example, if length is 6 and the dateCols type string is Y-M, arimax
predicts data for 6 months.
Note: If you want to use dateCols but your data stream has missing dates, use fill before using arimax.
• dateCols (optional) Date fields to use for grouping the data, plus the date column type string. For example,
dateCols=(CloseDate_Year, CloseDate_Month, "Y-M"). Date columns are projected automatically. Allowed
values are:
– YearField, MonthField, "Y-M"
– YearField, QuarterField, "Y-Q"
– YearField, "Y"
– YearField, MonthField, DayField "Y-M-D"
– YearField, WeekField "Y-W"
• ignoreLast (optional) If true, arimax doesn't use the last time period in the calculations. The default is false.
Set this parameter to true to improve the accuracy of the forecast if the last time period contains incomplete data. For example,
if you’re partway through the quarter, arimax forecasts more accurately if you set this parameter to true.
• order (optional) Specify the field to use for ordering the data. Mandatory if dateCols isn’t used. By default, this field is sorted
in ascending order. Use desc to specify descending order, for example order=('Type' desc). You can also order by
multiple fields, for example order=('Type' desc, 'Group' asc).
For example, suppose that your data has no date columns, but it has a measure column called Week. Use order='Week'.
Note: Specify either dateCols or order.
• partition (optional) Specify the column used to partition the data. The column must be a dimension. The arimax calculation
is done separately for each partition to ensure that each partition uses the most accurate algorithm. For example, data in one partition
can have a seasonal variation while data in another partition doesn't. The partition columns are projected automatically.
For example, suppose that your sales data for raw materials contains the date sold, type of raw material, and the weight sold. To
predict the future weight sold for each type of raw material, use partition='Type'.
• predictionInterval (optional) Specify the uncertainty, or confidence interval, to display at each point. Allowed values are
80 and 95. The upper and lower bounds of the confidence interval are projected in columns named column_name_low_95
and column_name_high_95.
Note: arimax doesn’t support missing data values in the forecast or xreg measures. You must pre-process your data to
replace missing values in the query before calling arimax
40
SAQL Reference
arimax
.
Syntax Examples
• Use arimax with the arimaOrder parameter.
q = arimax q generate 'Value' as 'fValue' with (length=10, dataCols=('Year', 'Month',
'Day', "Y-M-D"), arimaOrder=(1,0,1));
• Use arimax with the arimaOrder, xreg, and ignoreLast parameters.
q = arimax q generate 'Value' as 'fValue' with (length=10, dataCols=('Year', 'Month',
'Day', "Y-M-D"), arimaOrder=(1,0,1), xreg=('Price', 'Cost'), ignoreLast=true);
• Use multiple columns in the arimax forecast. If xreg is specified, multiple columns aren’t allowed.= arimax q generate
'Value' as 'fValue', 'Value2' as 'fValue2' with (length=10, dataCols=('Year', 'Month',
'Day', "Y-M-D"), arimaOrder=(1,0,1));
• Use arimax with the arimaOrder, seasonalOrder, and xreg parameters.
q = arimax q generate 'Value' as 'fValue' with (length=10, dataCols=('Year', 'Month',
'Day', "Y-M-D"), arimaOrder=(1,0,1), seasonalOrder=(1,0,1,4), xreg=('Price', 'Cost'));
seasonality
dateCols
Type of Seasonality
seasonalOrder=(1,0,1,4)
dateCols=('Year','Quarter',"Y-Q")
seasonalOrder=(1,0,1,12)
dateCols=('Year','Month',"Y-M")
seasonalOrder=(1,0,1,7)
dateCols=('Year','Month','Day',"Y-M-D")
Yearly seasonality, because there are 4
quarters in a year.
Yearly seasonality, because there are 12
months in a year.
Weekly seasonality, because there are 7 days
in a week.
Note: When the date type in the dateCols value doesn’t match the seasonal periodicity in seasonalOrder, the seasonal
periodicity takes precedence. For example, if dateCols=('Year','Month',"Y-M") and
seasonalOrder=(1,0,1,4) are in the same arimax statement, the seasonal period used for predictions is 4 or "Y-Q",
not "Y-M".
Use Case Examples
Suppose you have a dataset with 5 years of monthly power usage for a city, along with the corresponding average temperature and
precipitation for each month.
41
SAQL Reference
arimax
You can use a seasonal arimax query to predict the next 12 months of power usage, refining each prediction by adding more
parameters to your query. Start with a single variable prediction, then make it multivariate by adding xreg, and finally, create a what-if
analysis by adding xregFutures. For each visualization, a timeline chart is used, with Axis Mode set to Single Axis, Show Value As
set to Compact Number, and a predictive line added to the X-Axis.
Example: Seasonal QueryUse a seasonal arimax query to predict how much power the city will use in the upcoming year.
q = load "nyc_power_dates3";
q = group q by (CurrentDate_Year, CurrentDate_Month);
q = foreach q generate CurrentDate_Year, CurrentDate_Month, sum(power) as power;
q = arimax q generate power as fPower with (length=12, dateCols=(CurrentDate_Year,
CurrentDate_Month, "Y-M"), arimaOrder=(0,1,1), seasonalOrder=(0,1,1,12));
q = foreach q generate 'CurrentDate_Year' + "~~~" + 'CurrentDate_Month' as
'CurrentDate_Year~~~CurrentDate_Month', fPower;
Example: Multivariate Seasonal Query
Use a seasonal multivariate arimax query to predict how much power the city will use, using the temperature and
precipitation measures in the calculation of the predicted values.
q = load "nyc_power_dates3";
q = group q by (CurrentDate_Year, CurrentDate_Month);
q = foreach q generate CurrentDate_Year, CurrentDate_Month, sum(power) as power,
sum(temperature) as temperature, sum(precipitation) as precipitation;
q = arimax q generate power as fPower with (length=12, dateCols=(CurrentDate_Year,
CurrentDate_Month, "Y-M"), xreg=(temperature, precipitation), arimaOrder=(0,1,1),
42
SAQL Reference
arimax
seasonalOrder=(0,1,1,12));
q = foreach q generate 'CurrentDate_Year' + "~~~" + 'CurrentDate_Month' as
'CurrentDate_Year~~~CurrentDate_Month', fPower, temperature, precipitation;
Example: Multivariate Seasonal Query with Prediction Interval
Use a seasonal multivariate arimax query to predict how much power the city will use, using the temperature and
precipitation measures in the calculation of the predicted values. Then, add a predictionInterval to show the
prediction with 95% accuracy
q = load "nyc_power_dates3";
q = group q by (CurrentDate_Year, CurrentDate_Month);
q = foreach q generate CurrentDate_Year, CurrentDate_Month, sum(power) as power,
sum(temperature) as temperature, sum(precipitation) as precipitation;
q = arimax q generate power as fPower with (length=12, predictionInterval=95
dateCols=(CurrentDate_Year, CurrentDate_Month, "Y-M"), xreg=(temperature, precipitation),
arimaOrder=(0,1,1), seasonalOrder=(0,1,1,12));
q = foreach q generate 'CurrentDate_Year' + "~~~" + 'CurrentDate_Month' as
'CurrentDate_Year~~~CurrentDate_Month', fPower, fPower_high_95, fPower_low_95;
Example: What-If Analysis Query
Use the xregFutures parameter to provide possible future values for xreg fields to see what the effects are on the forecasted
fields for different sets of values
q = arimax q generate 'Value' as 'fValue' with (length=6, dateCols=('Year','Month','Day',
"Y-M-D"),
arimaOrder=(1,0,1), xreg=('col1', 'col2'), xregFutures=(col1: [1.0, 2.0, 3.0, 4.0,
5.0, 6.0], col2: [1.1, 2.2 3.3, 4.4, 5.5, 6.6]));
The user can pass in values for xreg fields that they want to do the what-if analysis on.
43
SAQL Reference
cogroup
Add xregFutures to the seasonal multivariate arimax query to predict how much power the city will use with
future temperature and precipitation values. In this query, the final 6 temperature future values have been
increased by 10 degrees each to alter the calculated values in the visualization.
q = load "nyc_power_dates3";
q = group q by (CurrentDate_Year, CurrentDate_Month);
q = foreach q generate CurrentDate_Year, CurrentDate_Month, sum(power) as power,
sum(temperature) as temperature, sum(precipitation) as precipitation;
q = arimax q generate power as fPower with (length=12, dateCols=(CurrentDate_Year,
CurrentDate_Month, "Y-M"),
xreg=(temperature, precipitation), arimaOrder=(0,1,1), seasonalOrder=(0,1,1,12),
xregFutures=(temperature: [67.09, 58.49, 44.91, 41.89, 34.75, 34.20, 39.18, 61.51,
70.59, 82.13, 89.54, 84.12],
precipitation: [0.0081, 0.0049, 0.0036, 0.0067, 0.0031, 0.0060, 0.0053, 0.0015, 0.0050,
0.0079, 0.0028, 0.0034]));
q = foreach q generate 'CurrentDate_Year' + "~~~" + 'CurrentDate_Month' as
'CurrentDate_Year~~~CurrentDate_Month', fPower, temperature, precipitation;
SEE ALSO:
timeseries
cogroup
Use cogroup to blend data from two or more data streams into a single data stream. The data streams must have at least one common
field.
cogroup is similar to relational database joins, but with some important differences. Unlike a relational database join, in a cogroup
the datasets are grouped first, and then the groups are joined. You can use cogroup in these ways:
• inner cogroup
• left outer cogroup
• right outer cogroup
• full outer cogroup
Note: The statements cogroup and group are interchangeable. For clarity, we use group for statements involving one
data stream and cogroup for statements involving two or more data streams.
Inner cogroup
Inner cogroup blends data from two or more data streams into a resulting data stream. The resulting data stream only contains values
that exist in both data streams. That is, unmatched records are dropped.
44
SAQL Reference
cogroup
Syntax
result = cogroup data_stream_1 by field1, data_stream_2 by field2;
field1 and field2 must be the same type, but can have different names. For example, q=group ops by 'Owner',
quota by 'Name';
Example - Inner cogroup
Suppose that you want to understand how much time your reps spend meeting with each account. Is there a relationship between
spending more time and winning an account? Are some reps spending much more or much less time than average? To answer these
questions, first blend meeting data with account data using cogroup.
Suppose that you have a dataset of meeting information from the Salesforce Event object. In this example, your reps have had six
meetings with four different companies. The Meetings dataset has a MeetingDuration column, which contains the meeting duration in
hours.
The account data exists in the Salesforce Opportunity object. The Ops dataset has an Account, Won, and Amount column. The Amount
column contains the dollar value of the opportunity, in millions.
45
SAQL Reference
cogroup
To see the effect of meeting duration on opportunities, you start by blending these two datasets into a single data stream using cogroup.
q = cogroup ops by 'Account', meetings by 'Company';
Internally (you cannot see these results yet), the resulting cogrouped data stream contains the following data. Note how the data streams
are rolled up on one or more dimensions.
(1,{(Shoes2Go,2),(Shoes2Go,5)},{(Shoes2Go,1,1.5),(Shoes2Go,0,3})
(2,{(FreshMeals,3),(FreshMeals, 1)},{(FreshMeals,1,2) (FreshMeals,1,1.4)})
(3,{(ZipBikeShare,4)},{(ZipBikeShare,1,1.1)})
(4,{(ZenRetreats,6)},{(ZenRetreats,0,2)})
Now the datasets are blended. To see the data, you create a projection using foreach:
ops = load "Ops";
meetings = load "Meetings";
q = cogroup ops by 'Account', meetings by 'Company';
q = foreach q generate ops.'Account' as 'Account', sum(ops.'Amount') as 'Sum of Amount',
sum(meetings.'MeetingDuration') as 'TimeSpent';
The resulting data stream contains the sum of amount and total meeting time for each company. The sum of amount is the sum of the
dollar value for every opportunity for the company.
Now that you have blended the data into a single data stream, you can analyze the effects that total meeting time has on your opportunities.
Left Outer cogroup
Left outer cogroup blends data from the right data stream with the left data stream. The resulting data stream only contains values
that exist in the left data stream. If the left data stream has a value that the right data stream does not, the missing value is null in the
resulting data stream.
Tip: Use coalesce to replace a null value with the value of your choice. See Example: Left Outer Cogroup with coalesce().
Syntax
result = cogroup data_stream_1 by field1 left, data_stream_2 by field2;
field1 and field2 must be the same type, but can have different names. For example, q=group ops by 'Owner' left,
quota by 'Name';
46
SAQL Reference
cogroup
Example - Left Outer cogroup With coalesce
Suppose that you want to see what percentage of quota that your reps have obtained. Your quota dataset shows each employee's quota
(notice that Farah does not have a quota):
Your opportunities data shows the opportunity amount that each employee has won (notice that Jonathan does not have a won
opportunity).
Use a left outer cogroup to show only employees that have quotas. Also show the percentage of quota attained.
quota = load "Quota";
opp = load "Opportunity";
q = group quota by 'Employee' left, opp by 'Employee';
q = foreach q generate quota.'Employee' as 'Employee',
trunc(sum(opp.'Amount')/sum(quota.'Quota')*100, 2) as 'Percent Attained';
Jonathan has not won any opportunities yet, so his percent attained is null.
Use coalesce to replace the null opportunities with a zero.
quota = load "Quota";
opp = load "Opportunity";
47
SAQL Reference
cogroup
q = group quota by 'Employee' left, opp by 'Employee';
q = foreach q generate quota.'Employee' as 'Employee',
trunc(coalesce(sum(opp.'Amount'),0)/sum(quota.'Quota')*100, 2) as 'Percent Attained';
Now Jonathan's percent attained is displayed as zero.
Right Outer cogroup
Right outer cogroup blends data from the left data stream with the right data stream. The resulting data stream only contains values
that exist in the right data stream. If the right data stream has a value that the left data stream does not, the missing value is null in the
resulting data stream.
Tip: Use coalesce to replace a null value with the value of your choice. See Example: Right Outer Cogroup with coalesce().
Syntax
result = cogroup data_stream_1 by field1 right, data_stream_2 by field2;
field1 and field2 must be the same type, but can have different names. For example, q=group ops by 'Owner'
right, quota by 'Name';
Full Outer cogroup
Full outer cogroup blends data from the left and right data streams. The resulting data stream contains all values. If one data stream
has a value that the other data stream does not, the missing value is null in the resulting data stream.
Tip: Use coalesce to replace a null value with the value of your choice.
Syntax
result = cogroup data_stream_1 by field1 full, data_stream_2 by field2;
48
SAQL Reference
fill
field1 and field2 must be the same type, but can have different names. For example, q=group ops by 'Owner' full,
quota by 'Name';
SEE ALSO:
union
join semi and anti
union
join semi and anti
Combine Data from Multiple Data Streams with cogroup
Replace Null Values with coalesce()
group-by
fill
Use fill() to fill in any gaps in date fields. You most often use fill() before using the timeseries statement. By specifying
the date fields to check, fill() creates a row that contains the missing month, day, week, quarter, or year and includes a null value.
To include values outside the bounds of your data’s date range, specify a start date and end date to override existing limits. The function
returns the missing date rows with null values.
Syntax
results = fill resultSet by (dateCols=(dateField1, dateField2, "<date format>"),
startDate=startDate, endDate=endDate, [partition])
Name
Description
resultSet
dateCols
Required. The results of a query that serve as input to the fill()
function. This resultSet must have non-null input, or the
timeseries()statement fails when run.
Required.
date_fields—The date fields in which to check for gaps.
The date format string accepts these values.
• 'yearField'
,
‘'monthField'
, 'Y-M'
• 'yearField'
,
'quarterField'
, 'Y-Q'
• 'yearField'
, 'Y'
• 'yearField'
,
'weekField'
, 'Y-W'
• 'yearField'
'Y-M-D'
,
'monthField'
,
'dayField'
,
startDate—The starting date value beyond the scope of your
data's date range.
endDate—The ending date value beyond the scope of your
data's date range.
49
SAQL Reference
fill
Name
Description
• You can use startDate and endDate together or one
and not the other.
• If you leave out startDate, then the start date is the earliest
date in your dataset.
• If you leave out endDate, then the end date is the latest date
in your dataset.
• If startDate and endDate are within the bounds of
your dataset, fill() ignores them.
partition
Optional. A named parameter used to split query results into smaller
parts. The fill() function resets when the named parameter
value changes. After each group of rows is completed for a given
partition, fill() runs on the next partition.
Example
This example uses fill() to add missing quarter and year values to tourist data.
q = load "TouristsData";
q = foreach q generate date_Year, date_Quarter, tourists;
q = fill q by (dateCols=(date_Year, date_Quarter, "Y-Q"));
q = limit q 15;
The query first returns the year, quarter, and number of tourists for each quarter. Based on the results from the first three years represented
in the dataset, the only date data available is for the first quarter.
These are the results from q = load "TouristsData"; q = foreach q generate date_Year, date_Quarter,
tourists;.
year
quarter
tourists
2001
2002
2003
1
1
1
4127
4173
4621
fill() specifies in the date_cols array to group the input data by the quarter and year. To have a complete dataset of years and
quarters, fill() adds the 2nd, 3rd, and 4th quarters for each year and a null value for the number of tourists.
year
quarter
tourists
2001
2001
2001
2001
1
2
3
4
4127
-
-
-
50
SAQL Reference
filter
year
quarter
tourists
2002
2002
2002
2002
2003
2003
2003
2003
1
2
3
4173
-
-
4
1
2
3
4
-
4621
-
-
-
Example with Extended Date Range
This query returns null values for tourists where date_Month and date_Year come before or after the date values in the dataset
or there are gaps within the data provided.
q = load "TouristsData";
q = foreach q generate date_Year, date_Month, tourists;
q = fill q by (dateCols=(date_Year, date_Month, "Y-M"), startDate="2000-10",
endDate="2001-07");
q = limit q 10;
date_Month
date_Year
tourists
10
11
12
01
02
03
04
05
06
07
2000
2000
2000
2001
2001
2001
2001
2001
2001
2001
-
-
-
41,735
-
-
26,665
-
-
-
filter
Selects rows from a dataset based on a filter predicate.
51
SAQL Reference
foreach
Syntax
result= filter rows by predicate;
Usage
A predicate is a Boolean expression that uses comparison or logical operators. The predicate is evaluated for every row. If the predicate
is true, the row is included in the result. Comparisons on dimensions are lexicographic, and comparisons on measures are numerical.
When a filter is applied to grouped data, the filter is applied to the rows in the group. If all member rows are filtered out, groups are
eliminated. You can run a filter statement before or after group to filter out members of the groups.
Note: With results binding, an error may occur if the results from a previous query exceed the values supported by SAQL. For
example, if something like filter q by dim1 in {{results(Query_1)}}; produces a filter tree with a depth
greater than 10,000 values, SAQL will fail with an error.
Example: The following example returns only rows where the origin is ORD, LAX, or LGA:
a1 = filter a by origin in ["ORD", "LAX", "LGA"];
Example: The following example returns only rows where the destination is LAX or the number of miles is greater than 1,500:
y = filter x by dest == "LAX" || miles > 1500;
Example: When in operates on an empty array in a filter operation, everything is filtered and the results are empty. The
second statement filters everything and returns empty results:
a = load "0Fbxx000000002qCAA/0Fcxx000000002WCAQ";
a = filter a by Year in [];
c = group a by ('Year', 'Name');
d = foreach c generate 'Name' as 'group::AName', 'Year' as 'group::Year',
sum(accounts::Revenue) as 'sRev';
SEE ALSO:
Comparison Operators
Logical Operators
Statements
Null Operators
Use Group and Filter Pre-projection
foreach
Applies a set of expressions to every row in a dataset. This action is often referred to as projection.
Syntax
q= foreach q generate expression as alias[, expression as alias ...];
The output column names are specified with the as keyword. The output data is ungrouped.
52
SAQL Reference
foreach
Using foreach with Ungrouped Data
When used with ungrouped data, the foreach statement maps the input rows to output rows. The number of rows remains the
same.
Example: a2 = foreach a1 generate carrier as carrier, miles as miles;
Using foreach with Grouped Data
When used with grouped data, the foreach statement behaves differently than it does with ungrouped data.
Fields can be directly accessed only when the value is the same for all group members. For example, the fields that were used as the
grouping keys have the same value for all group members. Otherwise, use aggregate functions to access the members of a group. The
type of the column determines which aggregate functions you can use. For example, if the column type is numeric, you can use the
sum() function.
Example: z = foreach y generate day as day, unique(origin) as uorg, count() as n;
Using foreach with a case Expression
To create logic in a foreach statement that chooses between conditional statements, use a case expression.
Projected Field Names
Each field name in a projection must be unique and not have the name 'none'. Invalid field names throw an error.
For example, the last line in this query is invalid because the same name is used for multiple projected fields:
l = load "0Fabb000000002qCAA/0Fabb000000002WCAQ";
r = load "0Fcyy000000002qCAA/0Fcyy000000002WCAQ";
l = foreach l generate 'value'/'divisor' as 'value' , category as category;
r = foreach r generate 'value'/'divisor' as 'value' , category as category;
cg = cogroup l by category right, r by category;
cg = foreach cg generate r.category as 'category', sum(r.value) as sumrval, sum(l.value)
as sumrval;
The following query is also invalid because the projected field name can't be 'none'.
q = load "Products";
q = group q by all;
q = foreach q generate count() as 'none';
q = limit q 2000;
Examples
For examples of projections, see Calculate Grand Totals and Subtotals with the rollup Modifier and grouping() Function .
SEE ALSO:
Statements
53
SAQL Reference
group-by
group-by
Organizes the rows returned from a query into groups. Within each group, you can apply an aggregate function, such as count() or
sum() to get the number of items or sum, respectively.
Syntax
group-by takes this syntax.
group data_stream by fields;
Parameter
Description
data_stream
fields
Data input to group.
Fields by which data is grouped.
Group-by One Field
In this example, the query counts the number of rows for each Category field and groups the counts by category.
q = load "Superstore";
q = group q by 'Category';
q = foreach q generate 'Category' as 'Category', count() as 'count';
q = limit q 2000;
Category
Count of Rows
Furniture
Office Supplies
Technology
2,121
6,026
1,847
Note: cogroup and group-by are interchangeable. For clarity, we use group-by for statements that involve one data
stream and cogroup for statements that involve two or more data streams.
Group-by with Null Values
To return grouped null values in your queries, you must select the preference to include null values in Setup. Otherwise, queries ignore
null values.
1. In Setup, enter Analytics in the Quick Find box.
2. 3. Select Settings from the list of Analytics options.
In Settings, click the checkbox for Include null values in Analytics queries.
54
SAQL Reference
group-by
Here’s an example of a query that returns null values. It orders the results by the Sub_Category field and specifies that the results
display in ascending order, with nulls first.
q = load "Superstore";
q = group q by 'Sub_Category';
q = foreach q generate 'Sub_Category' as 'Sub_Category', count() as 'count';
q = order q by 'Sub_Category' asc nulls first;
q = limit q 2000;
Sub-Category
Count of Rows
-
Accessories
Appliances
Art
Binders
Bookcases
Chairs
Copiers
Envelopes
Fasteners
Furnishings
Labels
Machines
Paper
Phones
Storage
Supplies
Tables
4
775
466
796
1,523
228
617
68
254
217
957
364
115
1,370
889
846
190
319
Group-by all
In this example, the query counts all of the rows and returns the number of different industries that you have opportunities with.
q = load "DTC_Opportunity_SAMPLE";
q = group q by all;
q = foreach q generate unique('Industry') as 'unique_Industry';
55
SAQL Reference
group-by rollup
#
Unique of Industry
1
20
SEE ALSO:
Aggregate Functions
Null Operators
cogroup
Use Group and Filter Pre-projection
group-by rollup
rollup is a subclause of group-by that creates and displays aggregations of grouped data. The output of rollup is based on
column order in your query.
Syntax
group-by rollup takes this syntax.
group data_stream by rollup(fields);
Parameter
Description
data_stream
fields
Data input to group.
Fields by which data is grouped.
Note: rollup works with group-by only. You cannot use it with cogroup.
rollup supports the following aggregate functions.
• average()
• count()
• min()
• max()
• sum()
• unique()
This example first groups the results by Category and Sub-Category, and runs sum('Sales'), an aggregate function on
each resulting row. By modifying the group-by clause with rollup, the query "rolls up" the results into subtotals and a grand total.
q = load "Superstore";
q = group q by rollup('Category', 'Sub_Category');
q = order q by ('Category');
q = foreach q generate 'Category' as 'Category', 'Sub_Category' as 'Sub_Category',
sum('Sales') as 'sum_sales';
56
SAQL Reference
group-by rollup
Category
Sub-Category
sum_sales
Furniture
Bookcases
Chairs
Furnishings
Tables
Office Supplies
Technology
-
Appliances
Art
Binders
Envelopes
Fasteners
Labels
Paper
Storage
Supplies
-
Accessories
Copiers
Machines
Phones
-
-
114,348
328,237
91,514
206,966
741,064
107,532
27,119
203,413
16,363
3,024
12,486
78,479
223,844
46,674
718,934
167,380
149,528
189,239
329,636
835,783
2,295,781
The query first groups the total sales for each sub-category of a given category. Next, it groups the total sales for a single category. After
each category's total sales is accounted for, the query generates the total sales for all categories.
rollup with Null Values
To return grouped null values in your queries, you must select the null handling for dimensions preference in Setup. See group-by
for more information.
This example shows how null values display in query results. The query is the same as the one in the first example.
q = load "Superstore";
q = group q by rollup('Category', 'Sub_Category');
q = foreach q generate 'Category' as 'Category', 'Sub_Category' as 'Sub_Category',
57
SAQL Reference
sum('Sales') as 'sum_sales';
q = order q by ('Category', 'Sub_Category');
Category
Sub-Category
Furniture
Bookcases
Chairs
Furnishings
Tables
-
Office Supplies
-
Appliances
Art
Binders
Envelopes
Fasteners
Labels
Paper
Storage
Supplies
-
Technology
-
Accessories
Copiers
Machines
Phones
-
-
-
Computers
Projectors
-
group-by rollup
sum_sales
114,348
328,237
91,514
206,966
92
741,156
107,532
27,119
203,413
16,363
3,024
12,486
78,479
223,844
46,674
273
719,206
167,380
149,528
189,239
329,636
259
836,041
113
744
562
1,420
2,297,824
58
SAQL Reference
group-by rollup
The query first groups the total sales for each sub-category of a given category. In this example, each category contains a null sub-category.
The value of the null sub-category is also included in the total sales for each sub-category.
After the query accounts for all of the named categories—categories that have a value—it displays the sub-categories and total sales
for null categories. Finally, the query generates the total sales for all categories.
rollup with Null Values and case Statements
Use the grouping function and case statements together to label the subtotal and grand total categories. In this example, the first
case checks for a null value generated by the rollup in the Category field. If true, then the query labels the field All Categories.
The second case checks whether a Sub-Category field is similarly null. If true, then the query labels the field All
Sub-Categories.
q = load "Superstore";
q = group q by rollup ('Category', 'Sub_Category');
q = foreach q generate
(case
when grouping('Category') == 1 then "All Categories"
else 'Category'
end) as 'Category',
(case
when grouping('Sub_Category') == 1 then "All Sub-Categories"
else 'Sub_Category'
end) as 'SubCategory', sum('Sales') as 'sum_sales';
Category
Sub-Category
sum_sales
Furniture
Bookcases
Chairs
Furnishings
Tables
Office Supplies
-
All Sub-Categories
Appliances
Art
Binders
Envelopes
Fasteners
Labels
Paper
Storage
Supplies
-
114,348
328,237
91,514
206,966
92
741,156
107,532
27,119
203,413
16,363
3,024
12,486
78,479
223,844
46,674
273
59
SAQL Reference
join semi and anti
Category
Sub-Category
sum_sales
Technology
All Sub-Categories
Accessories
Copiers
Machines
Phones
-
-
All Sub-Categories
Computers
Projectors
-
All Categories
All Sub-Categories
All Sub-Categories
719,206
167,380
149,528
189,239
329,636
259
836,041
113
744
562
1,420
2,297,824
SEE ALSO:
Null Operators
Simple case Operator
Aggregate Functions
grouping()
join semi and anti
Use the join statement with the join_type to create semi-join or anti-join results.
Usage
A semi-join returns the rows from one data stream if one or more matching rows are found in the second data stream. Each matched
row is returned one time. The row data types must match for the specified data streams.
An anti-join returns the rows in the first data stream that don’t match any rows in the second data stream.
Syntax
results = join alias1 by (field1, ... fieldK) join_type, alias2 by (field1, ... fieldK)
Name
Description
alias1
Required. The data stream to report semi-join or anti-join results
for.
60
SAQL Reference
join semi and anti
Name
Description
alias2
field1
join_type
Required. The data stream to look for matches or no matches in.
Required. The field name as it appears in the data stream. The field
data type must be the same in alias1 and alias2 to match.
Multi-value fields aren’t allowed. At least 1 field is requires, with a
maximum of 5 fields allowed. Duplicate field names aren’t allowed
in either data stream.
Required. The type of join to run. Valid values are semi and anti.
The result stream contains the matched or unmatched rows from the alias1 data stream only. For a semi-join, a row from alias1 is
only present if it satisfies the join criteria. The syntax supports equijoin (equality) criteria only. There isn't a guarantee that the rows
in the result stream are in the same order as in alias1.
The parenthesis used to specify the fields are optional if there’s only 1 field.
The input data stream aliases must be unique. These streams can't be unprojected group or cogroup results, either directly or
indirectly. The group or cogroup statement is made after the join statement.
Performance Considerations
• The join performance is directly proportional to the amount of data returned by the second dataset. We recommend running any
filters on the second dataset before running the join.
• Run the join before running any projections on the query results. For example, if you have a foreach statement in your query,
like q = foreach q generate count(q1) as 'A';, run it after the join statement.
Note: The join alias field must be a dimension or a date. If you use a measure field as an alias, the query returns an
error stating Error in join: non-dimension field: {field1} is not allowed in pre-projection
alias: {alias1} at join keys list position: 1. This restriction is only for pre-projection alias. All data
types are allowed in the post-projection alias.
For example, to use a measure in a join, project the measure field first. This query joins Number_of_Employees, a measure,
by projecting it before running the join.
c = load \"cases\";
a = load \"accounts\";
a = join a by Name semi, c by Name;
a = foreach a generate ID, Industry, Name, Year, Number_of_Employees;
a = order a by (ID);
Example: Semi-Join Syntax
a = join a by (id) semi, b by (id);
Example: Anti-Join Syntax
a = join a by (id) anti, b by (id);
61
SAQL Reference
join semi and anti
Example: Multiway Semi-Join Syntax
join statements can be combined to form a multiway semi-join. A maximum of 3 join statements are allowed in a query.
These statements combine into a conjunctive predicate.
a = join a by (id) semi, b by (id);
a = join a by (id) anti, c by (id);
join Use Cases
Use a join statement to query for accounts with at least 1 opportunity
account = load \"accounts\";
opp = load \"opportunities\";
q = join account by (id) semi, opp by (accountId);
Use a join statement to query for accounts with opportunity amount more than 10K.
account = load \"accounts\";
opp = load \"opportunities\";
opp = filter opp by amount > 10000;
q = join account by (id) semi, opp by (accountId);
Use a join statement to query for accounts with more than 10 opportunities.
account = load \"accounts\";
opp = load \"opportunities\";
opp = group opp by accountId;
q = join account by (id) semi, opp by (accountId);
q = foreach q generate accountId, count() as count;
q = filter q by count > 10;
Use a join statement to query for accounts with no opportunities.
account = load \"accounts\";
opp = load \"opportunities\";
q = join account by (id) anti, opp by (accountId);
Use a join statement to query for accounts with opportunities, but no orders.
account = load \"accounts\";
opp = load \"opportunities\";
orders = load \"orders\";
q = join account by (id) semi, opp by (accountId);
q = join q by (id) anti, orders by (accountId)
Example: Null Handling
Running the join query with null fields is a special case. For the SAQL anti-join statement, null isn't equal to null, which differs
from the cogroup statement. The behavior of the statement is the same as NOT EXISTS in SQL.
In this example, imagine you’re joining the accounts and the opportunities data streams, which contain these rows:
accounts
opportunities
id
account_id
62
SAQL Reference
join semi and anti
accounts
opportunities
1
2
NULL
1
NULL
For SAQL, this statement:
a = load \"accounts\";
opp = load \"opportunities\";
q = join a by (id) anti, opp by (account_id);
q = foreach q generate id, name;
has the same behavior as this SQL statement:
select id, name from accounts a where not EXISTS (select 1 from opportunities opp where
opp.account_id = a.id);
The SAQL anti-join query returns two rows:
[
{ id : null },
{ id : 2 }
]
Considerations
Using a union statement and a join statement in the same query has strict enforcements. When a semi or antijoin statement
is present, the union statement returns an error if there are:
• mismatched number of columns
• mismatched data types
The errors appear as "Different number of fields found across union streams" or "Different types found for field 1: 'fieldName' in
different union inputs."
There's also strict checking on the name of the columns. Using this SAQL example with a semi join statement and a union
statement:
q1 = load "Opportunity";
q2 = load "Opportunity";
q1 =join q1 by (AccountId) semi, q3 by (AccountId);
q2 = group q2 by all;
q1 = foreach q1 generate q1.'AccountId' as 'AccountId',q1.StageName as 'StageName',
q1.'Description' as 'Description', q1.'Id' as 'Id',q1.'Amount' as 'Amount', q1.'Probability'
as 'Probability';
q2 = foreach q2 generate null as 'AccountId', null as 'StageName',null as 'Description',null
as 'Id', sum(unique('Amount')) over([..] partition by all) as
'Amount_total',sum(unique('Probability')) over([..] partition by all) as 'Probability';
q1 = limit q1 5;
63
SAQL Reference
limit
qU = union q1, q2;
When the join is present, strict name checking only allows for one ‘Amount’ column name, which comes from the first stream, q1.
The ‘Amount_total’ summary column name from the second stream, q2, isn’t honored and only the normal 'Amount' column
name is in the union results. If the join statement is removed, both the normal ‘Amount’ and the summary ‘Amount_total’
column names are in the union results.
SEE ALSO:
cogroup
union
cogroup
limit
Limits the number of results that are returned. If you don’t set a limit, queries return a maximum of 10,000 rows.
Syntax
result= limit rows number;
Usage
Use this statement only on data that has been ordered with the order statement. The results of a limit operation aren’t automatically
ordered, and their order can change each time that statement is called.
You can use the limit statement with ungrouped data.
You can use the limit statement to limit grouped data by an aggregated value. For example, to find the top 10 regions by revenue:
group by region, call sum(revenue) to aggregate the data, order by sum(revenue) in descending order, and limit the
number of results to the first 10.
Note: The limit statement isn’t a top() or sample() function.
Example: This example limits the number of returned results to 10:
b = limit a 10;
The expression can’t contain any columns from the input. For example, this query is not valid:
b = limit OrderDate 10;
SEE ALSO:
Statements
order
64
SAQL Reference
load
load
Loads a dataset. All SAQL queries start with a load statement.
Syntax
result= load dataset;
If you’re working in Dashboard JSON, dataset must be the dataset name from the UI. Use of the dataset name (also called an alias)
means the app can substitute it with the correct version of the dataset.
If you’re working in the Analytics REST API, dataset must be the containerId/versionId.
Usage
After being loaded, the data is not grouped. The columns are the columns of the loaded dataset.
Example: Load the Accounts dataset to the stream 'b'. b = load "Accounts";
offset
Use offset to page through the results of your query.
Syntax
result= offset rows number;
Usage
Skips over the specified number of rows when returning the results of a query. You typically use offset to paginate the query results.
When using offset in your SAQL statements, be aware of these rules:
• The order of filter and order can be swapped because it doesn't change the results
• offset must be after order
• offset must be before limit
• There can be no more than one offset statement after a foreach statement
Example - Return Rows 51–101
This example loads the opportunity dataset, sorts the rows in alphabetical order by account owner, and returns rows 51–101:
q = load "DTC_Opportunity";
q = order q by 'Account_Owner';
q = foreach q generate 'Account_Owner' as 'Account_Owner', 'Account_Type' as 'Account_Type',
'Amount' as 'Amount';
65
SAQL Reference
order
q = offset q 50;
q = limit q 50;
SEE ALSO:
Statements
order
Sorts in ascending or descending order on one or more fields.
Syntax
result= order rows by field [ asc | desc ];
result= order rows by (field [ asc | desc ], field [ asc | desc ]);
result= order rows by field [ asc | desc ] nulls [first | last];
asc or desc specifies whether the results are ordered in ascending (asc) or descending (desc) order. The default order is ascending.
Usage
Use order to sort the results in a data stream for display. You can use order with ungrouped data. You can also use order to
sort grouped data by an aggregated value.
Do not use order to specify the order that another SAQL statement or function will process records in. For example, do not use order
before timeseries to change the order of processing. Instead, use timeseries parameters.
By default, nulls are sorted last when sorting in ascending order and first when sorting in descending order. You can change the ordering
of nulls using nulls [first | last].
Note: Applying labels to dimension values in the XMD changes the displayed values, but doesn’t change the sort order.
Example: q = order q by 'count' desc;
Example: To order a stream by multiple fields, use this syntax:
a = load "0Fbxx000000002qCAA/0Fcxx000000002WCAQ";
b = group a by (year, month);
c = foreach b generate year as year, month as month;
d = order c by (year desc, month desc);
Example: You can order a cogrouped stream before a foreach statement:
a = load "0Fbxx000000002qCAA/0Fcxx000000002WCAQ";
b = load "0Fayy000000002qCAA/0Fbyy000000002WCAQ";
c = cogroup a by year, b by year;
c = order c by a.airlineName;
c = foreach c generate year as year;
Example: By default, nulls are sorted first when sorting in descending order. To change the null sort order to last, use this syntax:
q = order q by last_shipping_cost desc nulls last;
66
SAQL Reference
sample
Example: operation.) This code throws an error:
You can’t reference a preprojection ID in a postprojection order operation. (Projection is another term for a foreach
q = load "0Fbxx000000002qCAA/0Fcxx000000002WCAQ";
q = group q by 'FirstName';
q = foreach q generate sum('mea_mm10M') as 'sum_mm10M';
q = order q by 'FirstName' desc;
This code is valid:
q = load "0Fbxx000000002qCAA/0Fcxx000000002WCAQ";
q = group q by 'FirstName';
q = foreach q generate 'FirstName' as 'User_FirstName', sum('mea_mm10M') as 'sum_mm10M';
q = order q by 'User_FirstName' desc;
SEE ALSO:
Statements
sample
Returns a random sample from a large dataset, where each data point has an equal probability of being selected. This keyword uses the
Bernoulli distribution.
Syntax
sample(percentage-size-of-dataset) repeatable(seed)
Parameter
Description
sample
repeatable
Required. Specifies the percentage of the dataset that is returned as a random sample. The
percentage size value can be any positive decimal.
Optional. To create a random sample deterministically, specify a seed. sample returns the
same subset of data each time you pass repeatable the same seed value. The seed value can
be any positive integer.
Usage
Use sample to project a query on a representative sample from your dataset, where each data point has an equal probability of being
selected. sample runs pre-projection.
Add sample and repeatable after the load statement. Any operation performed on the query after the load statement
affects only the random sample of data. Let’s look at an example.
q = load "Opportunity" sample(10) repeatable(1);
q = group q by all;
q = foreach q generate count() as 'count';
q = limit q 2000;
67
SAQL Reference
sample
Count of Rows
453
Here, the query returns the row count of the sample, 453—around 10% of the dataset's 4.6k rows. The repeatable keyword
guarantees that the query always returns the same result. Without the repeatable keyword, the query returns a sample of a slightly
different size each time you run it. If you modify your dataset and add more data, then repeatable doesn’t return the same result.
group-by Example
This query returns the counts of opportunities for each stage. Since the query operates on 10% of the dataset, the counts for each stage
are approximately 1/10 of the original count.
q = load "Opportunity" sample(10) repeatable(1);
q = group q by 'StageName';
q = foreach q generate 'StageName', count() as 'count';
q = limit q 2000;
Stage
Count of Rows
Closed Lost
Closed Won
Id. Decision Makers
Needs Analysis
Negotiation/Review
Perception Analysis
Proposal/Price Quote
Prospecting
Qualification
Value Proposition
89
254
13
15
6
13
9
10
25
19
filter Example
This query returns only the won opportunities for each stage. Since the query operates on 10% of the dataset, the count for each stage
is approximately 1/10 of the original count.
q = load "Opportunity" sample(10);
q = filter q by 'IsWon' == "true";
q = group q by 'StageName';
q = foreach q generate 'StageName', count() as 'count';
q = limit q 2000;
68
SAQL Reference
timeseries
Stage
Count of Rows
Closed Won
275
SEE ALSO:
Keywords
timeseries
Uses existing data to predict future data points. The timeseries statement must follow a projection statement in your query. Perform
any filtering pre-projection or after the timeseries statement.
Note: The timeseries statement requires a CRM Analytics Growth or CRM Analytics Plus license to return the full set of
results. Without one of these licenses, the timeseries statement doesn’t fail, but it only returns 1 period of forecasted data.
Usage
timeseries crunches your data and selects the forecasting model that gives the best fit. You can let timeseries select the best
model or specify the model you want. timeseries detects seasonality in your data. It considers periodic cycles when predicting
what your data will look like in the future. You can specify the type of seasonality or let timeseries choose the best fit.
The amount of data required to make a prediction depends on how your data is filtered and grouped. For example, for a non-seasonal
monthly model, 2 data points are sufficient, whereas for a seasonal monthly model, at least 24 data points (two seasonal cycles) are
required. If you don't have enough data to make a good prediction, timeseries returns nulls in the data. If no data is passed to
timeseries, an empty dataset is returned.
Syntax
result= timeseries resultSet generate (measure1 as fmeasure1 [, measure2 as
fmeasure2...]) with (parameters);
measure1, measure2, and so on, are the measures that you want to predict future values for. You can predict measures from
grouping queries or from simple values queries. The predicted values and the original values are projected together. The columns from
the previous foreach statement are also projected.
parameters can have the following values:
• length (required) Number of points to predict. For example, if length is 6 and the dateCols type string is Y-M, timeseries
predicts data for 6 months.
Note: If you want to use dateCols but your data stream has missing dates, use fill before using timeseries.
timeseries makes the most accurate prediction possible by choosing the best algorithm for your data. Predictive algorithms
are more accurate for shorter time periods.
• dateCols (optional) Date fields to use for grouping the data, plus the date column type string. For example,
dateCols=(CloseDate_Year, CloseDate_Month, "Y-M"). Date columns are projected automatically. Allowed
values are:
– YearField, MonthField, "Y-M"
– YearField, QuarterField, "Y-Q"
69
SAQL Reference
timeseries
– YearField, "Y"
– YearField, MonthField, DayField "Y-M-D"
– YearField, WeekField "Y-W"
• ignoreLast (optional) If true, timeseries doesn't use the last time period in the calculations. The default is false.
Set this parameter to true to improve the accuracy of the forecast if the last time period contains incomplete data. For example,
if you’re partway through the quarter, timeseries forecasts more accurately if you set this parameter to true.
• order (optional) Specify the field to use for ordering the data. Mandatory if dateCols isn’t used. By default, this field is sorted
in ascending order. Use desc to specify descending order, for example order=('Type' desc). You can also order by
multiple fields, for example order=('Type' desc, 'Group' asc).
For example, suppose that your data has no date columns, but it has a measure column called Week. Use order='Week'.
Note: Specify either dateCols or order.
• partition (optional) Specify the column used to partition the data. The column must be a dimension. The timeseries
calculation is done separately for each partition to ensure that each partition uses the most accurate algorithm. For example, data
in one partition can have a seasonal variation while data in another partition doesn't. The partition columns are projected automatically.
For example, suppose that your sales data for raw materials contains the date sold, type of raw material, and the weight sold. To
predict the future weight sold for each type of raw material, use partition='Type'.
• predictionInterval (optional) Specify the uncertainty, or confidence interval, to display at each point. Allowed values are
80 and 95. The upper and lower bounds of the confidence interval are projected in columns named column_name_low_95
and column_name_high_95.
• model (optional) Specify which prediction model to use. If unspecified, timeseries calculates the prediction for each model
and selects the best model using Bayesian information criterion (BIC).
Allowed values are:
– None timeseries selects the best algorithm for the data
– Additive uses Holt's Linear Trend or Holt-Winters method with additive components.
– Multiplicative uses Holt's Linear Trend or Holt-Winters method with multiplicative components
• seasonality (optional) Use with dateCols to specify the seasonality for your prediction. Allowed values are:
– 0 No seasonality
– any integer between 2 and 24
If unspecified, timeseries calculates the prediction for each type of seasonality and selects the results with the smallest error.
Example
seasonality
dateCols
Type of Seasonality
seasonality=4
dateCols="Y-Q"
seasonality=12
dateCols="Y-M"
seasonality=7
dateCols="Y-M-D"
Yearly seasonality, because there are four
quarters in a year.
Yearly seasonality, because there are 12
months in a year.
Weekly seasonality, because there are
seven days in a week.
70
SAQL Reference
timeseries
Tips
Here's how you can make the most of using timeseries:
• Are you currently part way through the month, quarter, or year? Consider setting ignoreLast to true so that timeseries
doesn't use the partial data in the current time period, leading to a more accurate prediction.
• Is timeseries not returning any data? If there aren't enough data points to make a good prediction, timeseries returns
null. Try increasing the number of data points.
• Is timeseries returning an error? You could have gaps in your dates or times. Like all good forecasting algorithms, timeseries
needs a continuous set of dates with no gaps, including in each partition. If you think your data has date gaps, try using fill on
page 49 first.
Example - How Many Tourists Will Visit Next Year?
Suppose that you run a chain of retail stores, and the number of tourists in your city affect your sales. Use timeseries to predict
how many tourists will come to your city next year:
q = load "TouristData";
q = group q by ('Visit_Year', 'Visit_Month');
q = foreach q generate 'Visit_Year', 'Visit_Month', sum('NumTourist') as 'sum_NumTourist';
-- If your data is missing some dates, use fill() before using timeseries()
-- Make sure that the dateCols parameter in fill() matches the dateCols parameter in
timerseries()
q = fill q by (dateCols=('Visit_Year','Visit_Month', "Y-M"));
-- Use timeseries() to predict the number of tourists.
q = timeseries q generate 'sum_NumTourist' as Tourists with (length=12,
dateCols=('Visit_Year','Visit_Month', "Y-M"));
q = foreach q generate 'Visit_Year' + "~~~" + 'Visit_Month' as 'Visit_Year~~~Visit_Month',
Tourists;
Use a timeline chart and set a predictive line to see the calculated future data. The resulting graph shows the likely number of tourists
in the future.
Example - Predict a Range with 95% Accuracy
Suppose that you wanted to predict the number of tourists in your city next year with 95% accuracy. Use predictionInterval=95
to set a 95% confidence interval for the number of tourists. The upper and lower bounds are projected as the fields
Tourists_high_95 and Tourists_low_95.
q = load "TouristData";
q = group q by ('Visit_Year', 'Visit_Month');
q = foreach q generate 'Visit_Year', 'Visit_Month', sum('NumTourist') as 'sum_NumTourist';
71
SAQL Reference
timeseries
-- If your data is missing some dates, use fill() before using timeseries()
-- Make sure that the dateCols parameter in fill() matches the dateCols parameter in
timerseries()
q = fill q by (dateCols=('Visit_Year','Visit_Month', "Y-M"));
-- use timeseries() to predict the number of tourists
q = timeseries q generate 'sum_NumTourist' as 'fTourists' with (length=12,
predictionInterval=95, dateCols=('Visit_Year','Visit_Month', "Y-M"));
q = foreach q generate 'Visit_Year' + "~~~" + 'Visit_Month' as 'Visit_Year~~~Visit_Month',
coalesce(sum_NumTourist,fTourists) as 'Tourists', fTourists_high_95, fTourists_low_95;
Use a timeline chart and set a predictive line to see the calculated future data. In the timeline chart options, select Single Axis for the
Axis Mode, fTourists_high_95 for Measure 1, and fTourists_low_95 for Measure 2. The resulting graph shows the likely number of
tourists in the future and the 95% confidence interval.
Example - Predict Seasonal Data
Suppose that you want to predict the revenue for each type of account. You know that your account revenue has yearly seasonality and
that you want to group dates by quarter, so you specify dateCols=('Date_Sold_Year','Date_Sold_Quarter',
"Y-Q") and seasonality = 4. To see the predicted values over the next year, use length=4 to specify four quarters.
q = load "Account";
q = group q by ('Date_Sold_Year', 'Date_Sold_Quarter', 'Type');
q = foreach q generate 'Date_Sold_Year', 'Date_Sold_Quarter', 'Type', sum('Amount') as
'sum_Amount';
-- If your data is missing some dates, use fill() before using timeseries()
-- Make sure that the dateCols parameter in fill() matches the dateCols parameter in
timerseries()
q = fill q by (dateCols=('Date_Sold_Year','Date_Sold_Quarter', "Y-Q"), partition='Type');
-- use timeseries() to predict the amount sold
q = timeseries q generate 'sum_Amount' as Amount with (partition='Type',length=4,
dateCols=('Date_Sold_Year','Date_Sold_Quarter', "Y-Q"), seasonality = 4);
q = foreach q generate 'Date_Sold_Year' + "~~~" + 'Date_Sold_Quarter' as
'Date_Sold_Year~~~Date_Sold_Quarter','Type', Amount ;
Use a timeline chart and set a predictive line to see the calculated future data. The resulting graph shows the likely sum of revenue for
each account, taking into account the quarterly seasonal variation.
72
SAQL Reference
union
SEE ALSO:
Forecast Future Data Points with timeseries
arimax
union
Combines multiple result sets into one result set. The result sets must have the same field names and structure. You can use a different
dataset to create each result set, or you can use the same dataset.
Syntax
result= union resultSetA, resultSetB [, resultSetC ...];
Example
q = union q1, q2, q3;
Example
You want to see how each rep compares to the average for deals won. You can make this comparison by appending these two result
sets together:Then use union to append the two result sets.
• Total amount of opportunities won for each rep
• Average amount of opportunities won for all reps
First, show the total amount of won opportunities for each rep.
opt = load "DTC_Opportunity_SAMPLE";
opt = filter opt by 'Won' == "true";
-- group by owner
rep = group opt by 'Account_Owner';
-- project the sum of amount for each rep
rep = foreach rep generate 'Account_Owner' as 'Account_Owner', sum('Amount') as 'sum_Amount';
rep = order rep by 'sum_Amount' desc;
The resulting graph shows the sum of amount for each rep.
73
SAQL Reference
union
Next, calculate the average of the sum of the amounts for each rep using the average function.
-- grouping rep by all returns all the data in a single row.
avg_rep = group rep by all;
-- Calculate the average of the Sum of Amount column.
-- Use the text ‘Average Deal Size’ in the ‘Account Owner’ column
avg_rep = foreach avg_rep generate "Average deal size" as 'Account_Owner', avg('sum_Amount')
as 'sum_Amount';
Because the two data streams have the same field names and structure, you can use union to combine them.
q = union rep, avg_rep;
The resulting graph contains the sum of amounts by each rep together with the average amount per rep.
Combine the SAQL fragments to get the complete SAQL statement.
opt = load "DTC_Opportunity_SAMPLE";
opt = filter opt by 'Won' == "true";
-- group by owner
rep = group opt by 'Account_Owner';
-- project the sum of amount for each rep
rep = foreach rep generate 'Account_Owner' as 'Account_Owner', sum('Amount') as 'sum_Amount';
rep = order rep by 'sum_Amount' desc;
-- grouping rep by all returns all the data in a single row.
74
SAQL Reference
union
avg_rep = group rep by all;
-- Calculate the average of the Sum of Amount column.
-- Use the text ‘Average Deal Size’ in the ‘Account Owner’ column
avg_rep = foreach avg_rep generate "Average deal size" as 'Account_Owner', avg('sum_Amount')
as 'sum_Amount';
q = union rep, avg_rep;
Considerations
Using a union statement and a join statement in the same query has strict enforcements. When a semi or antijoin statement
is present, the union statement returns an error if there are:
• mismatched number of columns
• mismatched data types
The errors appear as "Different number of fields found across union streams" or "Different types found for field 1: 'fieldName' in
different union inputs."
There's also strict checking on the name of the columns. Using this SAQL example with a semi join statement and a union
statement:
q1 = load "Opportunity";
q2 = load "Opportunity";
q1 =join q1 by (AccountId) semi, q3 by (AccountId);
q2 = group q2 by all;
q1 = foreach q1 generate q1.'AccountId' as 'AccountId',q1.StageName as 'StageName',
q1.'Description' as 'Description', q1.'Id' as 'Id',q1.'Amount' as 'Amount', q1.'Probability'
as 'Probability';
q2 = foreach q2 generate null as 'AccountId', null as 'StageName',null as 'Description',null
as 'Id', sum(unique('Amount')) over([..] partition by all) as
'Amount_total',sum(unique('Probability')) over([..] partition by all) as 'Probability';
q1 = limit q1 5;
qU = union q1, q2;
When the join is present, strict name checking only allows for one ‘Amount’ column name, which comes from the first stream, q1.
The ‘Amount_total’ summary column name from the second stream, q2, isn’t honored and only the normal 'Amount' column
name is in the union results. If the join statement is removed, both the normal ‘Amount’ and the summary ‘Amount_total’
column names are in the union results.
SEE ALSO:
cogroup
cogroup
join semi and anti
Append Datasets using union
Append Datasets using union
75