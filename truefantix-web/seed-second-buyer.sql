PRAGMA foreign_keys=ON;

DELETE FROM "Seller" WHERE "id" = 'buyer2_res_test';

INSERT INTO "Seller" ("id","name","creditBalanceCredits","rating","reviews","createdAt","updatedAt")
VALUES ('buyer2_res_test','Buyer 2 Res Test',5,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
