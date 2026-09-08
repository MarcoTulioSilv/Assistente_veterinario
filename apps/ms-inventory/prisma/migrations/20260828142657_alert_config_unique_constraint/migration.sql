-- CreateIndex
CREATE UNIQUE INDEX "alert_configs_product_id_alert_type_key" ON "alert_configs"("product_id", "alert_type");
