import { Module } from "@nestjs/common";
import { FilingsController } from "./filings.controller.js";
import { FilingsService } from "./filings.service.js";

@Module({
    controllers: [FilingsController],
    providers: [FilingsService],
})
export class FilingsModule {}