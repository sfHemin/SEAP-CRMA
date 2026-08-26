Analytics Assets Resources
Query Analytics assets using parameters for a collections or query a single asset by ID.
Available resources:
Resource	Description	Supported HTTP Method	Resource URL
Analytics Assets Collection Resource	Returns a collection of Analytics assets specified by the input parameters.	POST	/analytics​/assets/query
Analytics Asset Resource	Returns an Analytics asset.	GET	/analytics​/assets​/query/​<assetId>
Analytics Assets Collection Resource
Returns a collection of Analytics assets.
Analytics Asset Resource
Returns an Analytics asset by ID.Analytics Assets Collection Resource
Returns a collection of Analytics assets.
Resource URL
/analytics/assets/query
Formats
JSON

Available Version
55.0

HTTP Methods
POST

Request body for POST
Analytics Asset Collection Query Input

Note

The request body can be empty JSON if no query parameters are needed.

Response body for POST
Analytics Asset Collection
Analytics Asset Resource
Returns an Analytics asset by ID.
Resource URL
/analytics/assets/query/<assetId>
Formats
JSON

Available Version
55.0

HTTP Methods
GET

Response body for GET
Analytics Asset