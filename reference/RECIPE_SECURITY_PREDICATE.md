# Recipe security predicate — row-level security on the dataset a recipe produces

> Concepts / search keywords: security predicate, row-level security, recipe rowLevel,
> restrict who sees dataset rows, sharing inheritance, dataset access control, user role predicate,
> secure a recipe output dataset.

**A security predicate is CRM Analytics' row-level security: a boolean expression, evaluated per
row per viewing user, that decides which rows that user can see in the produced dataset.** It is
set on the **recipe's target dataset**, so scope it correctly when building a recipe that outputs
sensitive data (opportunities, quota, revenue).

## Where it lives (RECIPE, R3)

The predicate is the **`rowLevel`** property of the recipe definition — "the security predicate of
the target dataset" (CRM Analytics REST, since API v38.0). It applies to the dataset the recipe
registers. It is **not** a node-level field. (The legacy *dataflow* equivalent is
`rowLevelSecurityFilter` on the `sfdcRegister` node — different mechanism; see RECIPE_VS_DATAFLOW.md.
This doc is the recipe side.)

## Predicate syntax (same expression language either way)

A predicate compares a **dataset field** to a **`$User` attribute**:

```
'OwnerId' == "$User.Id"
```
Only rows the viewing user owns are visible. Combine with `||` / `&&`:

```
'OwnerRole' == "$User.UserRoleId" || 'OwnerId' == "$User.Id"
```
Row visible if the viewer owns it OR shares the owner's role. Common building blocks:
- `'<Field>' == "$User.Id"` — record owner
- `'<RoleField>' == "$User.UserRoleId"` — same role
- `'<Field>' == "$User.<CustomAttr>__c"` — any User field / custom attribute
- Always-visible-to-admins pattern: `|| "$User.ProfileId" == "<adminProfileId>"`

The field on the left must **exist in the produced dataset** — if you predicate on `OwnerRole`,
the recipe must output an `OwnerRole` field. A predicate referencing a missing field fails the
dataset at query time.

## When to set it (decide per recipe — don't skip, don't over-restrict)
- **Sensitive, per-user data** (rep sees only their opps): set an owner/role predicate.
- **Company-wide reporting dataset** everyone may see: no predicate (or a permissive one) is fine —
  don't add row security that isn't required.
- **Sharing inheritance in use:** you must STILL set a security predicate as the fallback for rows
  where Salesforce sharing can't be honored (per the CRM Analytics Security guide).

## Gotchas
- Predicate errors are silent until **query time** — a dataset with a bad predicate registers fine
  but every dashboard on it shows an error. Validate the referenced fields exist in the output.
- String literals use **double quotes**; field names use **single quotes**: `'Field' == "$User.Id"`.
- Case-sensitive field and attribute names.
- Changing a predicate takes effect on the next dataset load/run, not retroactively on an open dashboard.

## See also
- `CRM Analytics Security Implementation Guide` — full security-predicate + sharing-inheritance reference.
- `Recipe reference` — the `rowLevel` property on the recipe definition (target-dataset predicate).
- `RECIPE_VS_DATAFLOW.md` — the legacy `sfdcRegister.rowLevelSecurityFilter` equivalent, for reading old dataflows.
