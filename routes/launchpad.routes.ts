import { Router } from 'express';
import * as LaunchpadController from '../controllers/launchpad';
import * as DividendController from '../controllers/dividend';

const launchpadRoutes = Router();

launchpadRoutes.post('/launches', LaunchpadController.createLaunch);
launchpadRoutes.get('/launches', LaunchpadController.listLaunches);
launchpadRoutes.get('/launches/:launchId', LaunchpadController.getLaunch);
launchpadRoutes.patch('/launches/:launchId/status', LaunchpadController.transitionLaunchStatus);
launchpadRoutes.get('/launches/:launchId/pi-power', LaunchpadController.getMyPiPower);
launchpadRoutes.post('/launches/:launchId/commit', LaunchpadController.commitPi);
launchpadRoutes.post('/launches/:launchId/engagement', LaunchpadController.recordEngagement);
launchpadRoutes.post('/launches/:launchId/close-window', LaunchpadController.closeParticipationWindow);
launchpadRoutes.post('/launches/:launchId/run-allocation', LaunchpadController.runAllocation);
launchpadRoutes.post('/launches/:launchId/escrow', LaunchpadController.createEscrow);
launchpadRoutes.post('/launches/:launchId/execute-tge', LaunchpadController.executeEscrowAndTge);
launchpadRoutes.post('/launches/:launchId/dividend-rounds', DividendController.createRound);

export default launchpadRoutes;
