# Amazon India contribution calculator

The single-SKU calculator is `index.html`; the multi-SKU calculator is `bulk.html`. Each SKU row has its own referral rate, closing fee, fulfilment/shipping charge and other selling fees. Download a fresh CSV template from the bulk page when importing, because the **other** fee column was added.

## Calculation basis

For each order placed:

```
kept fraction = 1 - return rate
net sale = customer-paid price / (1 + product GST rate)
contribution =
  kept fraction × (net sale - product cost - packaging
    - referral rate × customer-paid price - closing fee
    - shipping fee - other completed-order fees)
  - return rate × extra loss per returned order
  - ad-spend rate × customer-paid price
```

This is a planning estimate, not Amazon's fee calculator or a Seller Central settlement. The seller must enter current, SKU-specific fees. Price means the actual customer-paid amount after discounts. Fees and costs are entered without recoverable input GST. Fully refunded returns are assumed resaleable; put all unrecovered charges, damage and handling in the return-loss field. Ads % is measured against gross placed-order value.

## Saving submissions

The `feature/save-calculations` branch adds `api/calculations.js` for a Vercel Node function and `@neondatabase/serverless`. The API validates the row values, recalculates results on the server, then saves seller name, email, entered SKU economics, result, consent time and separate optional marketing consent in Neon. It offers no public read endpoint. The form reports a save failure if the endpoint or database is unavailable.

Before merging/deploying:
1. Connect the original `GrowthRocketind/amazon-profit-calculator` repository to a Vercel project. The currently accessible Vercel GitHub scope is `IshBatra`; importing by URL would clone to another repo.
2. Attach the approved Growth Astronaut Neon integration to that Vercel project so `DATABASE_URL` is set as a server-side secret for production and preview. Never put the value in GitHub or client code.
3. Deploy the branch to preview, submit one consented test row and two rows with different fees, verify the saved records in Neon, then remove test records through the database console if desired.
4. Merge only after the save flow works end to end. Set a privacy retention/deletion policy for collected leads and restrict database-console access to the owner.

No direct formula parity with Amazon is claimed. Reconcile sampled outcomes to actual Seller Central settlements.
