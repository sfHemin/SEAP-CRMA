Create a Derived Measure
Perform calculations on existing measures and use the result to create a new, or derived, measure.
CRM Analytics calculates the value of derived measures at run time using the values from other fields.
Note

You can also create a derived measure in a dataflow rather than at runtime using SAQL. Measures created during a dataflow are calculated when the data is imported and may result in better performance.

Example - Calculate the Time to Win
Suppose that you have an Opportunities dataset with the Close Date and Open Date fields. You want to see the number of days it took to win the opportunity. Use CloseDate_day_epoch and CreatedDate_day_epoch to create a derived measure called Time to Win: ('CloseDate_day_epoch'- 'CreatedDate_day_epoch') as 'Time to Win'.

The field Time to Win is calculated at run time:

q = load "Opportunities";
q = foreach q generate 'CloseDate_day_epoch' as 'CloseDate_day_epoch', 'CreatedDate_day_epoch' as 'CreatedDate_day_epoch', 'Opportunity_Name' as 'Opportunity_Name', ('CloseDate_day_epoch'- 'CreatedDate_day_epoch') as 'Time to Win';
The resulting table contains the number of days to win each opportunity:

Derived dimension shows time to win