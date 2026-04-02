import { Router, type IRouter } from "express";
import healthRouter from "./health";
import monitorRouter from "./monitor";
import candlesRouter from "./candles";
import historyRouter from "./history";

const router: IRouter = Router();

router.use(healthRouter);
router.use(monitorRouter);
router.use(candlesRouter);
router.use(historyRouter);

export default router;
