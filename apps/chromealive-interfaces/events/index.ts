import IDatastoreOutputEvent from './IDatastoreOutputEvent';
import IHeroSessionActiveEvent from './IHeroSessionActiveEvent';
import IDomStateUpdateEvent from './IDomStateUpdatedEvent';
import IAppMoveEvent from './IAppMoveEvent';
import IAppModeEvent from './IAppModeEvent';
import ICommandUpdatedEvent from './ICommandUpdatedEvent';
import ISourceCodeUpdatedEvent from './ISourceCodeUpdatedEvent';
import ICommandFocusedEvent from './ICommandFocusedEvent';
import IDomFocusEvent from './IDomFocusEvent';
import IDomUpdatedEvent from './IDomUpdatedEvent';
import ISessionTimetravelEvent from './ISessionTimetravelEvent';
import IInterceptInspectElementMode from './IInterceptInspectElementMode';
import IDatastoreCollectedAssetEvent from './IDatastoreCollectedAssetEvent';
import IElementSummary from '../IElementSummary';

export default interface IChromeAliveEvents {
  'App.show': { onTop: boolean };
  'App.hide': null;
  'App.startedDraggingChrome': null;
  'App.stoppedDraggingChrome': null;
  'App.quit': null;
  'App.moveTo': IAppMoveEvent;
  'App.mode': IAppModeEvent;
  'Session.loading': void;
  'Session.loaded': void;
  'Session.active': IHeroSessionActiveEvent;
  'Session.timetravel': ISessionTimetravelEvent;
  'Session.interceptInspectElementMode': IInterceptInspectElementMode;
  'Datastore.output': IDatastoreOutputEvent;
  'Datastore.collected-asset': IDatastoreCollectedAssetEvent;
  'Dom.updated': IDomUpdatedEvent;
  'Dom.focus': IDomFocusEvent;
  'DomState.updated': IDomStateUpdateEvent;
  'Command.updated': ICommandUpdatedEvent;
  'Command.focused': ICommandFocusedEvent;
  'SourceCode.updated': ISourceCodeUpdatedEvent;
  'DevtoolsBackdoor.toggleInspectElementMode': { isActive: boolean };
  'DevtoolsBackdoor.elementWasSelected': { element: IElementSummary };
}
